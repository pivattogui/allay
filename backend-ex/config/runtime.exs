import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/allay start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if System.get_env("PHX_SERVER") do
  config :allay, AllayWeb.Endpoint, server: true
end

config :allay, AllayWeb.Endpoint, http: [port: String.to_integer(System.get_env("PORT", "4000"))]

if data_dir = System.get_env("DATA_DIR") do
  config :allay, :data_dir, data_dir
end

mc_port_min = System.get_env("MC_PORT_MIN")
mc_port_max = System.get_env("MC_PORT_MAX")

if mc_port_min && mc_port_max do
  config :allay, :mc_port_range, String.to_integer(mc_port_min)..String.to_integer(mc_port_max)
end

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      For example: ecto://USER:PASS@HOST/DATABASE
      """

  maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  config :allay, Allay.Repo,
    # ssl: true,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    # For machines with several cores, consider starting multiple pools of `pool_size`
    # pool_count: 4,
    socket_options: maybe_ipv6

  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  # HTTP-only homelab: derive host + WebSocket origin check from
  # ALLAY_PUBLIC_ORIGIN. Unset → localhost with check_origin disabled
  # (same-origin only). PORT is set above for all environments.
  {host, check_origin} =
    AllayWeb.EndpointConfig.origin(System.get_env("ALLAY_PUBLIC_ORIGIN"))

  config :allay, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  config :allay, AllayWeb.Endpoint,
    url: [host: host],
    http: [
      # Bind on all IPv4 interfaces; the container maps the port out.
      ip: {0, 0, 0, 0},
      port: String.to_integer(System.get_env("PORT", "4000"))
    ],
    check_origin: check_origin,
    secret_key_base: secret_key_base
end
