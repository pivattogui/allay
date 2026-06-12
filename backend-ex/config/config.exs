# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :allay,
  ecto_repos: [Allay.Repo],
  generators: [timestamp_type: :utc_datetime, binary_id: true]

# Configure the endpoint
config :allay, AllayWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: AllayWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Allay.PubSub,
  live_view: [signing_salt: "2anyuaKv"]

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Redact secrets from logged request params (the socket connect token must
# never reach production logs).
config :phoenix, :filter_parameters, ["password", "token"]

config :allay, :minecraft_req_options, []

config :allay, :data_dir, "data"

config :allay, :mc_port_range, 25_565..25_575

config :allay, Oban,
  engine: Oban.Engines.Basic,
  repo: Allay.Repo,
  queues: [backups: 1, restarts: 1],
  plugins: [
    {Oban.Plugins.Pruner, max_age: 60 * 60 * 24 * 7},
    {Oban.Plugins.Cron,
     crontab: [
       {"* * * * *", Allay.Backups.SchedulerTick},
       {"* * * * *", Allay.Servers.RestartTick}
     ]}
  ]

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
