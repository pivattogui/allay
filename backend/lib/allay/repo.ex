defmodule Allay.Repo do
  use Ecto.Repo,
    otp_app: :allay,
    adapter: Ecto.Adapters.Postgres
end
