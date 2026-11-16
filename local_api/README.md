# YuE2 local writing-assistant bridge

This folder runs a tiny OpenAI-compatible server on this PC and forwards
YuE2's Writing Assistant calls to NovaRouter's **Kimi K3.1 Pro**.

## YuE2 settings

| Field | Value |
|---|---|
| Mode | **Local server** |
| Base URL | `http://127.0.0.1:1234/v1` |
| Model name | `gpt-5.6-sol` |
| API key | `nova-local` (any saved value also works; the bridge is localhost-only) |

> **Current model:** NightRouter is temporarily hidden, so the bridge uses
> **GPT-5.6 Sol** (a visible NovaRouter model) for lyric writing. The browser
> model dropdown can still say `kimi-k3.1-pro-free`; the bridge maps every
> requested model name to the configured one. Switch `"model"` back to
> `kimi-k3.1-pro` in `config.json` after NightRouter returns.

Then press **Refresh** if you want YuE2 to read the model list, and **Done**.

## Start / stop

The bridge is installed for auto-start at `%USERPROFILE%\NovaLocalAPI`.
Windows Task Scheduler runs the supervisor **`NovaLocalYuE2Proxy` at logon**;
if the bridge crashes, the supervisor starts it again within a few seconds.
It is hidden (no console window) and survives reboots while this Windows user
is logged in.

Manual start / restart:

```bat
%USERPROFILE%\NovaLocalAPI\start_auto_hidden.bat
```

Or run it in a console for logs:

```bat
python local_api\yue2_proxy.py
```

Runtime logs: `%USERPROFILE%\NovaLocalAPI\proxy.log`.

Health check: <http://127.0.0.1:1234/health>

To remove the auto-start later:

```powershell
Unregister-ScheduledTask -TaskName NovaLocalYuE2Proxy -Confirm:$false
```

## Notes

- The real NovaRouter API key is in `config.json`; that file is gitignored.
- The bridge binds to `127.0.0.1` only. It is not reachable from other machines.
- It forwards `/v1/models`, `/v1/chat/completions` and SSE streaming.
- If port `1234` is already used by LM Studio, change `"port"` in `config.json`
  and use the same port in YuE2's Base URL.
