# tmux session-tracking guidance

Read this when changing the tracker daemon, pane annotations, heartbeat recovery, topology, or attention state.

tmux owns session, window, and pane topology. The Pi session tracker contains only derived, reconstructible runtime state. Do not add durable task, workspace, or pane-orchestration state without a demonstrated feature need.

tmux pane IDs are canonical terminal endpoint identities. The Pi adapter owns a live process's reported state. The daemon is a disposable cache and aggregator. `@pidev_*` pane options are annotations and restart hints, not an authoritative database.

Tracker failure must not stop Pi or the tmux pane. Recovery state must remain reconstructible from live reports and tmux hints.
