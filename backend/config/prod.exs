import Config

# Do not print debug messages in production
config :logger, level: :info

# HTTP-only single-container homelab deploy: no force_ssl/HSTS (handled by a
# reverse proxy upstream if TLS is ever needed). Vite already content-hashes
# assets, so there is no Phoenix digest manifest to reference.
#
# Runtime production configuration, including reading
# of environment variables, is done on config/runtime.exs.
