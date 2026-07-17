import Config

# runtime.exs runs for every environment, after compilation and before boot —
# the right place to read env vars (and, in releases, the only one). We load
# `.env` files here with Dotenvy so a single source of truth (env, with the
# defaults below) drives dev and prod alike.
#
# Dotenvy API: `env/3` reads with a default; `env!/2` is required (raises when
# missing). `:test` is intentionally skipped — config/test.exs owns the test
# database (SQL sandbox pool) and must not be overridden by a stray local `.env`.
if config_env() != :test do
  import Dotenvy

  # Lenient load (missing files are fine — releases/CI ship none). Real
  # environment variables (System.get_env) take precedence over file values.
  source!([
    Path.absname(".env"),
    Path.absname(".#{config_env()}.env"),
    System.get_env()
  ])

  # Enable the HTTP server. In dev `mix phx.server` sets this; in a release
  # set PHX_SERVER=true.
  if env!("PHX_SERVER", :boolean, false) do
    config :allay, AllayWeb.Endpoint, server: true
  end

  if dir = env!("DATA_DIR", :string, nil) do
    config :allay, :data_dir, dir
  end

  mc_port_min = env!("MC_PORT_MIN", :integer, nil)
  mc_port_max = env!("MC_PORT_MAX", :integer, nil)

  if mc_port_min && mc_port_max do
    config :allay, :mc_port_range, mc_port_min..mc_port_max
  end

  # Colon-separated JDK install roots (e.g. an asdf/Homebrew root for native
  # dev). Each is scanned for `<entry>/bin/java`. Overrides the Linux defaults.
  if scan_dirs = env!("JAVA_SCAN_DIRS", :string, nil) do
    config :allay, :java_scan_dirs, String.split(scan_dirs, ":", trim: true)
  end
end

if config_env() == :dev do
  import Dotenvy

  config :allay, :cors_allowed_origins, [
    env!("FRONTEND_ORIGIN", :string, "http://localhost:5173")
  ]

  config :allay, Allay.Repo,
    url: env!("DATABASE_URL", :string, "ecto://allay:allay@localhost:5432/allay_dev"),
    pool_size: env!("POOL_SIZE", :integer, 10),
    stacktrace: true,
    show_sensitive_data_on_connection_error: true

  config :allay, AllayWeb.Endpoint,
    http: [ip: {127, 0, 0, 1}, port: env!("PORT", :integer, 4000)],
    secret_key_base:
      env!(
        "SECRET_KEY_BASE",
        :string,
        "q9aU5T1vlBdrtvGyZugXDQPobQTIl/yaSaPdiFCtRbnURNhNM6aUqBy7IyK1N+hg"
      )
end

if config_env() == :prod do
  import Dotenvy

  maybe_ipv6 = if env!("ECTO_IPV6", :boolean, false), do: [:inet6], else: []

  config :allay, Allay.Repo,
    url: env!("DATABASE_URL", :string!),
    pool_size: env!("POOL_SIZE", :integer, 10),
    socket_options: maybe_ipv6

  host =
    env!("ALLAY_PUBLIC_ORIGIN", :string, nil)
    |> AllayWeb.EndpointConfig.backend_host()

  frontend_origin = env!("FRONTEND_ORIGIN", :string!)

  config :allay, :dns_cluster_query, env!("DNS_CLUSTER_QUERY", :string, nil)
  config :allay, :cors_allowed_origins, [frontend_origin]

  config :allay, AllayWeb.Endpoint,
    url: [host: host],
    http: [
      # Bind on all IPv4 interfaces; the container maps the port out.
      ip: {0, 0, 0, 0},
      port: env!("PORT", :integer, 4000)
    ],
    check_origin: [frontend_origin],
    secret_key_base: env!("SECRET_KEY_BASE", :string!)
end
