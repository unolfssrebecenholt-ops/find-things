# Anti-Abuse Ops Notes

Manual cloud DB records used by analyze anti-abuse controls:

- `ft_ops_config/global`: global switches and defaults.
  - `dailyFreeAnalyzeLimit`: default daily successful analyzes per user. Defaults to `15`.
  - `maxAnalyzeImageBytes`: AI input image hard limit in bytes. Defaults to `6291456` (`6MB`).
  - `cooldownMs`: minimum interval between analyze attempts. Defaults to `30000`.
  - `hourlyAttemptLimit`: max attempts in one rolling hour. Defaults to `30`.
  - `analyzeEnabled`: set to `false` to temporarily close recognition for everyone. Defaults to enabled.
- `ft_user_quota_overrides/{openid}`: per-user daily successful analyze limit.
  - `dailyAnalyzeLimit`: overrides the global default for that user. It can be higher or lower than the default; `0` means the user has no available analyze quota.
- `ft_abuse_flags/{openid}`: manual block records.
  - `blocked`: set to `true` to block analyze usage.
  - `blockedUntil`: optional millisecond timestamp. Empty or `0` means blocked until manually changed.
  - `reason` / `note`: short operator-facing context.
- `ft_user_usage/{openid}_{YYYY-MM-DD}`: system-maintained daily counters. Do not edit manually unless repairing data after an incident.

Daily usage resets by natural day in China time (`Asia/Shanghai`, 00:00). Only successful recognition consumes the daily quota; failed recognition still counts toward cooldown and hourly attempt controls.

Do not store secrets in these records. Keep notes short and operator-facing.
