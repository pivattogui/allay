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
      {Registry, keys: :unique, name: Allay.Servers.OperationRegistry},
      {Oban, Application.fetch_env!(:allay, Oban)},
      {DNSCluster, query: Application.get_env(:allay, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Allay.PubSub},
      Allay.Servers.JavaRegistry,
      Allay.Runtime.Supervisor,
      Allay.Servers.Boot,
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
