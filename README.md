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

The server also embeds a browser client inspired by the macOS SwiftUI app. Start
the HTTP listener and open <http://127.0.0.1:9230/>:

```powershell
cowchat-server serve --http 127.0.0.1:9230 --enable-http-signup
```

Use the `Create key` button on the connection screen, then connect and chat from
the browser. For a locked-down server, omit `--enable-http-signup` and paste an
existing Cowchat API key instead.
