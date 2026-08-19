# cowchat4win

Windows-focused port of [Cowchat](https://github.com/cowboyinc/cowchat).

The first milestone is making the Rust server daemon and CLI run well on
Windows:

```powershell
cargo build -p cowchat-server -p cowchat-cli
cowchat-server serve
cowchat status
```

On Windows, the CLI defaults to loopback TCP at `127.0.0.1:9229`. Unix-domain
socket support remains available on Unix platforms.

The macOS app and website sources are kept as upstream reference material for
now. A Windows HTML UI can be built after the server and CLI path is solid.
