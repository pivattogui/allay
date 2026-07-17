import Config

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :allay, Allay.Repo,
  username: "allay",
  password: "allay",
  hostname: "localhost",
  database: "allay_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :allay, AllayWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "TffSvx6SNEskzhMrwyN498DUqND0u63gcdWeZFKiDo262hiQLo8IRKxWLkijKRbs",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true

config :bcrypt_elixir, :log_rounds, 1

# `retry: false` skips Req's default 5xx exponential backoff — the upstream-error
# paths (FETCH_VERSIONS_FAILED, jar-download 500) should fail fast in tests.
config :allay, :minecraft_req_options, plug: {Req.Test, Allay.Minecraft.APIStub}, retry: false

# Boot.run starts auto_start servers from the DB at app boot. In test, the
# sandbox owns the connection per-test, so skip it entirely; boot is tested
# by calling Boot.run/1 directly.
config :allay, :boot_autostart, false

# Keep runtime discovery deterministic. Individual tests provide fake JDK roots.
config :allay, :java_auto_discovery, false

# Oban manual testing mode disables queue draining and plugins so tests
# control job execution explicitly via Oban.Testing helpers.
config :allay, Oban, testing: :manual
