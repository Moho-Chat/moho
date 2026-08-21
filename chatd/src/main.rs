mod accounts;
mod backend;
mod events;
mod model;
mod net;
mod nickserv;
mod rpc;
mod runtime;
mod state;
mod store;

use accounts::AccountStore;
use anyhow::{bail, Context, Result};
use events::EventBus;
use fs2::FileExt;
use runtime::Runtime;
use state::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use store::Store;

struct Options {
    data_dir: PathBuf,
    socket_path: Option<PathBuf>,
}

fn parse_args() -> Options {
    let mut data_dir = dirs::home_dir()
        .expect("no home directory")
        .join(".config")
        .join("moho");
    let mut socket_path = None;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--data-dir" => {
                if let Some(v) = args.next() {
                    data_dir = PathBuf::from(v);
                }
            }
            "--socket-path" => {
                if let Some(v) = args.next() {
                    socket_path = Some(PathBuf::from(v));
                }
            }
            other => eprintln!("chatd: ignoring unrecognized argument {other:?}"),
        }
    }

    Options { data_dir, socket_path }
}

/// flock()-based singleton lock, same purpose as
/// daemon/chatd/chatd.c's acquire_singleton_lock(): prevent two chatd
/// processes racing the same socket/account-store. The lock file's fd is
/// deliberately leaked (`std::mem::forget`) for the process lifetime - it
/// releases automatically on exit/crash.
fn acquire_singleton_lock(data_dir: &std::path::Path) -> Result<()> {
    let lock_path = data_dir.join("chatd.lock");
    let file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .open(&lock_path)
        .with_context(|| format!("opening {}", lock_path.display()))?;
    if file.try_lock_exclusive().is_err() {
        bail!("another chatd instance is already running (lock held on {})", lock_path.display());
    }
    std::mem::forget(file); // keep the lock for the process lifetime
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    // Both the `irc` crate's tls-rust feature and the Discord backend's
    // websocket/HTTP clients pull in rustls, but via different transitive
    // paths that don't agree on a default crypto backend (ring vs
    // aws-lc-rs) - left unresolved, rustls refuses to guess and panics on
    // the first TLS handshake of the process. Pin one explicitly, once.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let opts = parse_args();
    std::fs::create_dir_all(&opts.data_dir)
        .with_context(|| format!("creating {}", opts.data_dir.display()))?;

    if let Err(e) = acquire_singleton_lock(&opts.data_dir) {
        tracing::info!("{e}, exiting");
        return Ok(());
    }

    let store = Store::open(&opts.data_dir.join("scrollback.db"))
        .context("opening scrollback store")?;
    let accounts = AccountStore::open(opts.data_dir.join("accounts.toml"))
        .context("opening account store")?;

    let state = AppState {
        store: Arc::new(store),
        accounts: Arc::new(accounts),
        events: EventBus::new(),
        runtime: Arc::new(Runtime::new()),
        tor: Arc::new(net::tor::TorManager::new(&opts.data_dir)),
    };

    // Reconnect every saved account, same as
    // daemon/chatd/actions.c's chatd_reconnect_saved_accounts() - without
    // this, an account created in a previous run just sits there after a
    // restart.
    for cfg in state.accounts.all_irc() {
        backend::irc::spawn(state.clone(), cfg);
    }
    for cfg in state.accounts.all_discord() {
        backend::discord::spawn(state.clone(), cfg);
    }
    for cfg in state.accounts.all_sockchat() {
        backend::sockchat::spawn(state.clone(), cfg);
    }
    for cfg in state.accounts.all_matrix() {
        backend::matrix::spawn(state.clone(), cfg);
    }

    tokio::spawn(run_housekeeping(state.clone()));

    let socket_path = opts.socket_path.unwrap_or_else(rpc::default_socket_path);
    let rpc_state = state.clone();

    tokio::select! {
        result = rpc::start(rpc_state, socket_path) => result,
        _ = shutdown_signal() => {
            // A bare process kill just drops every TCP connection without
            // telling the server - confirmed live against Libera.Chat, an
            // account killed this way can leave a "ghost" session holding
            // the nick hostage until the network's own ping-timeout
            // notices the dead peer, causing the *next* connect attempt to
            // fail with "Nickname is already in use". Send real QUITs and
            // give them a moment to reach the network before exiting.
            tracing::info!("shutting down, sending QUIT to all connected accounts");
            state.runtime.quit_all("Leaving");
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            Ok(())
        }
    }
}

/// Keeps two genuinely unbounded-over-time growth vectors in check for as
/// long as this daemon process stays up: scrollback (a busy buffer left
/// open for months of uptime never stops growing on its own) and the
/// Sneedchat avatar cache (every distinct poster ever seen gets a
/// permanently-cached file - see backend/sockchat/mod.rs's
/// cached_avatar_path). Neither is a one-time startup cost, so this
/// re-runs periodically rather than once.
async fn run_housekeeping(state: AppState) {
    const SCROLLBACK_KEEP_PER_BUFFER: i64 = 5000;

    // Let the initial reconnect burst above settle before the first pass.
    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    loop {
        match state.store.prune_old_messages(SCROLLBACK_KEEP_PER_BUFFER) {
            Ok(0) => {}
            Ok(n) => {
                tracing::info!("scrollback: pruned {n} row(s) beyond {SCROLLBACK_KEEP_PER_BUFFER} kept per buffer");
                if let Err(e) = state.store.incremental_vacuum() {
                    tracing::debug!("scrollback: incremental_vacuum failed: {e}");
                }
            }
            Err(e) => tracing::warn!("scrollback: pruning failed: {e}"),
        }

        backend::sockchat::sweep_avatar_cache().await;
        backend::sockchat::sweep_attachment_cache().await;
        backend::matrix::sweep_media_cache().await;

        tokio::time::sleep(backend::sockchat::AVATAR_CACHE_SWEEP_INTERVAL).await;
    }
}

async fn shutdown_signal() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.ok(); };
    #[cfg(unix)]
    let terminate = async {
        let mut sig = match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(s) => s,
            Err(_) => return,
        };
        sig.recv().await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}
