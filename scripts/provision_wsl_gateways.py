#!/usr/bin/env python3

import json
import os
import secrets
import shutil
import subprocess
import sys
from pathlib import Path


HOME = Path("/root")
SYSTEMD_USER_DIR = HOME / ".config" / "systemd" / "user"
NODE_BIN_DIR = Path("/root/.nvm/versions/node/v22.22.0/bin")
OPENCLAW_DIST = "/usr/lib/node_modules/openclaw/dist/index.js"
DEFAULT_PATH = (
    f"{NODE_BIN_DIR}:/root/.local/bin:/root/.npm-global/bin:/root/bin:"
    "/root/.volta/bin:/root/.asdf/shims:/root/.bun/bin:/root/.nvm/current/bin:"
    "/root/.fnm/current/bin:/root/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin"
)


MAIN_GATEWAY_TOKEN = os.environ["MAIN_GATEWAY_TOKEN"]
MAIN_TELEGRAM_BOT_TOKEN = os.environ["MAIN_TELEGRAM_BOT_TOKEN"]
MAIN_DISCORD_TOKEN = os.environ["MAIN_DISCORD_TOKEN"]
NEWS_TELEGRAM_BOT_TOKEN = os.environ["NEWS_TELEGRAM_BOT_TOKEN"]
DOCTOR_GATEWAY_TOKEN = os.environ["DOCTOR_GATEWAY_TOKEN"]
DOCTOR_TELEGRAM_BOT_TOKEN = os.environ["DOCTOR_TELEGRAM_BOT_TOKEN"]
TAVILY_API_KEY = os.environ["TAVILY_API_KEY"]
KIMI_API_KEY = os.environ["KIMI_API_KEY"]
MOONSHOT_API_KEY = os.environ["MOONSHOT_API_KEY"]
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
NEWS_GATEWAY_TOKEN = os.environ.get("NEWS_GATEWAY_TOKEN") or secrets.token_hex(24)


GATEWAYS = [
    {
        "id": "main",
        "label": "Main Gateway",
        "profile": None,
        "state_dir": HOME / ".openclaw",
        "workspace_dir": HOME / ".openclaw" / "workspace",
        "service_name": "openclaw-gateway.service",
        "port": 18790,
        "token": MAIN_GATEWAY_TOKEN,
        "env_vars": {
            "TAVILY_API_KEY": TAVILY_API_KEY,
            "KIMI_API_KEY": KIMI_API_KEY,
            "MOONSHOT_API_KEY": MOONSHOT_API_KEY,
            "GEMINI_API_KEY": GEMINI_API_KEY,
        },
        "telegram_token": MAIN_TELEGRAM_BOT_TOKEN,
        "discord_token": MAIN_DISCORD_TOKEN,
        "browser_profile": "zihan-profile",
        "memory_search": False,
        "compaction_mode": None,
        "subagent_max_concurrent": None,
    },
    {
        "id": "gateway-lxgnews",
        "label": "LXG News Gateway",
        "profile": "gateway-lxgnews",
        "state_dir": HOME / ".openclaw-gateway-lxgnews",
        "workspace_dir": HOME / ".openclaw-gateway-lxgnews" / "lxg-workspace",
        "service_name": "openclaw-gateway-lxgnews.service",
        "port": 18791,
        "token": NEWS_GATEWAY_TOKEN,
        "env_vars": {
            "TAVILY_API_KEY": TAVILY_API_KEY,
            "KIMI_API_KEY": KIMI_API_KEY,
            "MOONSHOT_API_KEY": MOONSHOT_API_KEY,
            "GEMINI_API_KEY": GEMINI_API_KEY,
        },
        "telegram_token": NEWS_TELEGRAM_BOT_TOKEN,
        "discord_token": MAIN_DISCORD_TOKEN,
        "browser_profile": None,
        "memory_search": True,
        "compaction_mode": "safeguard",
        "subagent_max_concurrent": 8,
    },
    {
        "id": "doctor",
        "label": "Doctor Gateway",
        "profile": "doctor",
        "state_dir": HOME / ".openclaw-doctor",
        "workspace_dir": HOME / ".openclaw-doctor" / "workspace",
        "service_name": "openclaw-gateway-doctor.service",
        "port": 18802,
        "token": DOCTOR_GATEWAY_TOKEN,
        "env_vars": {
            "KIMI_API_KEY": KIMI_API_KEY,
            "MOONSHOT_API_KEY": MOONSHOT_API_KEY,
            "GEMINI_API_KEY": GEMINI_API_KEY,
        },
        "telegram_token": DOCTOR_TELEGRAM_BOT_TOKEN,
        "discord_token": None,
        "browser_profile": None,
        "memory_search": True,
        "compaction_mode": None,
        "subagent_max_concurrent": None,
    },
]


WORKSPACE_TEMPLATE_FILES = {
    "AGENTS.md": """# AGENTS.md\n\nRead `SOUL.md`, `USER.md`, and the last two daily notes before you start working.\nLoad `MEMORY.md` only in the main session.\nKeep notes in files before relying on memory.\nDo not expose private data.\n""",
    "SOUL.md": """# SOUL.md\n\nBe direct, useful, and calm.\nPrefer action over filler.\nProtect private data.\nAsk before taking irreversible external actions.\n""",
    "IDENTITY.md": """# IDENTITY.md\n\n- Name: {name}\n- Role: {role}\n- Emoji: {emoji}\n""",
    "USER.md": """# USER.md\n\n- Name: Zihan\n- What to call them: Zihan\n- Timezone: Asia/Shanghai\n""",
    "TOOLS.md": """# TOOLS.md\n\nLocal notes for this gateway live here.\nAdd environment-specific tool details as they become relevant.\n""",
    "HEARTBEAT.md": """# HEARTBEAT.md\n\nKeep this file empty unless you want explicit periodic checks.\n""",
    "NOW.md": """# NOW.md\n\n## P0\n- Keep this gateway healthy and ready for the next task.\n""",
    "MEMORY.md": """# MEMORY.md\n\nLong-term notes for this gateway.\n""",
    "memory/INDEX.md": """# Memory Index\n\n- Add important notes here as they accumulate.\n""",
}


WORKSPACE_PROFILES = {
    "main": {"name": "Main Gateway", "role": "Primary assistant", "emoji": ":lobster:"},
    "gateway-lxgnews": {"name": "LXG News", "role": "News-focused gateway", "emoji": ":newspaper:"},
    "doctor": {"name": "Doctor Gateway", "role": "Home medical helper", "emoji": ":stethoscope:"},
}


def run(command, *, check=True, env=None, capture_output=False, input_text=None):
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    return subprocess.run(
        command,
        check=check,
        env=merged_env,
        text=True,
        input=input_text,
        capture_output=capture_output,
    )


def log(message):
    print(message, flush=True)


def openclaw_cmd(gateway):
    base = ["/usr/bin/openclaw"]
    if gateway["profile"]:
        base.extend(["--profile", gateway["profile"]])
    return base


def ensure_dir(path):
    path.mkdir(parents=True, exist_ok=True)


def ensure_workspace(gateway):
    ensure_dir(gateway["workspace_dir"])
    ensure_dir(gateway["workspace_dir"] / "memory" / ".archive")
    ensure_dir(gateway["workspace_dir"] / "memory" / "reviews")
    profile_meta = WORKSPACE_PROFILES[gateway["id"]]
    for relative_path, template in WORKSPACE_TEMPLATE_FILES.items():
        target = gateway["workspace_dir"] / relative_path
        if target.exists():
            continue
        ensure_dir(target.parent)
        target.write_text(
            template.format(**profile_meta),
            encoding="utf-8",
        )


def write_env_files(gateway):
    env_lines = [f"{key}={value}" for key, value in gateway["env_vars"].items()]
    env_content = "\n".join(env_lines) + "\n"
    for name in (".env", "env"):
        target = gateway["state_dir"] / name
        ensure_dir(target.parent)
        target.write_text(env_content, encoding="utf-8")


def update_json(path, mutate):
    data = {}
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
    mutate(data)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def config_validate(gateway):
    command = openclaw_cmd(gateway) + ["config", "validate"]
    run(command)


def ensure_browser_profile(gateway):
    return


def write_gateway_manifest():
    manifest_path = HOME / ".openclaw-manager" / "gateways.json"
    ensure_dir(manifest_path.parent)
    manifest = {
        "generatedAt": run(
            ["/bin/date", "-Iseconds"],
            capture_output=True,
        ).stdout.strip(),
        "gateways": [
            {
                "id": gateway["id"],
                "label": gateway["label"],
                "profile": gateway["profile"],
                "serviceName": gateway["service_name"],
                "stateDir": str(gateway["state_dir"]),
                "workspaceDir": str(gateway["workspace_dir"]),
                "port": gateway["port"],
                "browserProfile": gateway["browser_profile"],
            }
            for gateway in GATEWAYS
        ],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def service_unit_text(gateway):
    profile_args = ""
    if gateway["profile"]:
        profile_args = f" --profile {gateway['profile']}"
    return f"""[Unit]
Description={gateway['label']} (OpenClaw 2026.3.13)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/node {OPENCLAW_DIST}{profile_args} gateway --port {gateway['port']} --bind loopback --token {gateway['token']}
Restart=always
RestartSec=5
TimeoutStopSec=30
TimeoutStartSec=30
SuccessExitStatus=0 143
KillMode=control-group
Environment=HOME=/root
Environment=TMPDIR=/tmp
Environment=PATH={DEFAULT_PATH}
Environment=OPENCLAW_GATEWAY_PORT={gateway['port']}
Environment=OPENCLAW_SYSTEMD_UNIT={gateway['service_name']}
Environment=OPENCLAW_SERVICE_MARKER={gateway['id']}
Environment=OPENCLAW_SERVICE_KIND=gateway
Environment=OPENCLAW_SERVICE_VERSION=2026.3.13

[Install]
WantedBy=default.target
"""


def write_service_units():
    ensure_dir(SYSTEMD_USER_DIR)
    for gateway in GATEWAYS:
        unit_path = SYSTEMD_USER_DIR / gateway["service_name"]
        unit_path.write_text(service_unit_text(gateway), encoding="utf-8")


def enable_and_restart_services():
    run(["/usr/bin/systemctl", "--user", "daemon-reload"])
    for gateway in GATEWAYS:
        run(["/usr/bin/systemctl", "--user", "enable", "--now", gateway["service_name"]])
        run(["/usr/bin/systemctl", "--user", "restart", gateway["service_name"]])


def verify_gateways():
    statuses = []
    for gateway in GATEWAYS:
        service_status = run(
            ["/usr/bin/systemctl", "--user", "is-active", gateway["service_name"]],
            check=False,
            capture_output=True,
        )
        listener_status = run(
            ["/usr/bin/ss", "-ltn", f"sport = :{gateway['port']}"],
            check=False,
            capture_output=True,
        )
        statuses.append(
            {
                "id": gateway["id"],
                "port": gateway["port"],
                "serviceName": gateway["service_name"],
                "serviceActive": service_status.stdout.strip(),
                "serviceExitCode": service_status.returncode,
                "listenerExitCode": listener_status.returncode,
                "listenerOutput": listener_status.stdout.strip(),
            }
        )
    report_path = HOME / ".openclaw-manager" / "gateway-health.json"
    report_path.write_text(json.dumps(statuses, indent=2), encoding="utf-8")


def backup_main_config():
    config_path = HOME / ".openclaw" / "openclaw.json"
    if not config_path.exists():
        return
    backup_path = config_path.with_suffix(".json.pre-multi-gateway.bak")
    if not backup_path.exists():
        shutil.copy2(config_path, backup_path)


def patch_config_json(gateway):
    config_path = gateway["state_dir"] / "openclaw.json"

    def mutate(data):
        data.setdefault(
            "commands",
            {
                "native": "auto",
                "nativeSkills": "auto",
                "restart": True,
                "ownerDisplay": "raw",
            },
        )
        agents = data.setdefault("agents", {})
        defaults = agents.setdefault("defaults", {})
        defaults["workspace"] = str(gateway["workspace_dir"])
        defaults["model"] = {
            "primary": "kimi-coding/k2p5",
            "fallbacks": [
                "moonshot/kimi-k2.5",
                "moonshot/kimi-k2-thinking",
            ],
        }
        defaults["models"] = {
            "kimi-coding/k2p5": {},
            "moonshot/kimi-k2.5": {},
            "moonshot/kimi-k2-thinking": {},
        }
        if gateway["memory_search"]:
            defaults["memorySearch"] = {
                "enabled": True,
                "provider": "gemini",
            }
        else:
            defaults.pop("memorySearch", None)
        if gateway["compaction_mode"]:
            defaults["compaction"] = {"mode": gateway["compaction_mode"]}
        else:
            defaults.pop("compaction", None)
        if gateway["subagent_max_concurrent"] is not None:
            subagents = defaults.setdefault("subagents", {})
            subagents["maxConcurrent"] = gateway["subagent_max_concurrent"]
        else:
            defaults.pop("subagents", None)

        browser = data.setdefault("browser", {})
        browser["headless"] = True
        browser["noSandbox"] = True

        channels = data.setdefault("channels", {})
        channels["telegram"] = {
            "enabled": True,
            "dmPolicy": "pairing",
            "botToken": gateway["telegram_token"],
            "groupPolicy": "allowlist",
            "streaming": "partial",
        }
        if gateway["discord_token"]:
            channels["discord"] = {
                "enabled": True,
                "token": gateway["discord_token"],
                "groupPolicy": "allowlist",
                "streaming": "off",
            }
        else:
            channels.pop("discord", None)

        plugins = data.setdefault("plugins", {})
        entries = plugins.setdefault("entries", {})
        entries["telegram"] = {"enabled": True}
        if gateway["discord_token"]:
            entries["discord"] = {"enabled": True}
        else:
            entries.pop("discord", None)

        gateway_config = data.setdefault("gateway", {})
        gateway_config["port"] = gateway["port"]
        gateway_config["mode"] = "local"
        gateway_config["bind"] = "loopback"
        gateway_config["auth"] = {
            "mode": "token",
            "token": gateway["token"],
        }
        if gateway["id"] == "main":
            control_ui = gateway_config.setdefault("controlUi", {})
            control_ui["allowedOrigins"] = [
                "http://localhost:18790",
                "http://127.0.0.1:18790",
            ]
            control_ui["dangerouslyAllowHostHeaderOriginFallback"] = False
        else:
            gateway_config.pop("controlUi", None)

    update_json(config_path, mutate)


def configure_gateway(gateway):
    log(f"[configure] {gateway['id']} start")
    ensure_dir(gateway["state_dir"])
    ensure_workspace(gateway)
    write_env_files(gateway)
    patch_config_json(gateway)
    ensure_browser_profile(gateway)
    config_validate(gateway)
    log(f"[configure] {gateway['id']} done")


def main():
    log("[main] backup")
    backup_main_config()
    for gateway in GATEWAYS:
        configure_gateway(gateway)
    log("[main] manifest")
    write_gateway_manifest()
    log("[main] units")
    write_service_units()
    log("[main] services")
    enable_and_restart_services()
    log("[main] verify")
    verify_gateways()
    log("[main] done")


if __name__ == "__main__":
    main()
