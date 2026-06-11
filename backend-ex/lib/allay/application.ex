defmodule Allay.Application do
  # See https://elixir.hexdocs.pm/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      AllayWeb.Telemetry,
      Allay.Repo,
      {DNSCluster, query: Application.get_env(:allay, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Allay.PubSub},
      # Start a worker by calling: Allay.Worker.start_link(arg)
      # {Allay.Worker, arg},
      # Start to serve requests, typically the last entry
      AllayWeb.Endpoint
    ]

    # See https://elixir.hexdocs.pm/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Allay.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    AllayWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
