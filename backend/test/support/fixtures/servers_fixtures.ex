defmodule Allay.ServersFixtures do
  @moduledoc false

  alias Allay.Repo
  alias Allay.Servers.Server

  @doc """
  Inserts a server row directly via Repo, bypassing the changeset port-range
  check. Uses ports outside the configured MC range (30000+) to avoid
  collisions with range-validation tests.
  """
  def server_fixture(attrs \\ %{}) do
    # Ports 30000..39999 — well outside the 25565..25575 MC range.
    # unique_integer avoids collisions across concurrent async: false tests.
    unique = System.unique_integer([:positive, :monotonic])
    port = 30_000 + rem(unique, 10_000)
    rcon_port = port + 10_000

    attrs =
      %{
        name: "Test Server #{unique}",
        type: "vanilla",
        version: "1.21.4",
        port: port,
        ram_min_mb: 1024,
        ram_max_mb: 2048,
        directory: "/data/servers/test-#{unique}",
        rcon_port: rcon_port,
        rcon_password: "rconpass123"
      }
      |> Map.merge(attrs)

    %Server{}
    |> Ecto.Changeset.cast(attrs, [
      :name,
      :type,
      :version,
      :port,
      :ram_min_mb,
      :ram_max_mb,
      :java_version,
      :directory,
      :auto_start,
      :auto_restart,
      :restart_limit,
      :icon_path,
      :jvm_args,
      :java_path,
      :restart_schedule,
      :rcon_port,
      :rcon_password
    ])
    |> Repo.insert!()
  end
end
