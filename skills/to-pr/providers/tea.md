# Forgejo and Gitea

Provider for Forgejo/Gitea remotes.

1. Run `tea pull create --help` and use the syntax that command prints; versions
   differ.
2. If the head branch is in a fork, the head value is `<user>:<branch>`.
   Otherwise the head value is `<branch>`.
3. Build the create command with the syntax from step 1.
4. When `HEAD` has no upstream, prepend `git push -u <remote> HEAD && ` to the
   create command so the push and the pull request run as one command under one
   approval.
5. Report the URL printed by `tea`.
