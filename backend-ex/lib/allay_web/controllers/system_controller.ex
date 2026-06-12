defmodule AllayWeb.SystemController do
  use AllayWeb, :controller

  alias Allay.Minecraft.Versions
  alias Allay.Servers.JavaRegistry

  action_fallback AllayWeb.FallbackController

  @server_types [
    %{id: "vanilla", name: "Vanilla"},
    %{id: "paper", name: "Paper"}
  ]

  def server_types(conn, _params) do
    json(conn, %{types: @server_types})
  end

  def versions(conn, %{"type" => "vanilla"}), do: list_versions(conn, :vanilla)
  def versions(conn, %{"type" => "paper"}), do: list_versions(conn, :paper)
  def versions(_conn, _params), do: {:error, :invalid_server_type}

  defp list_versions(conn, type) do
    case Versions.available_versions(type) do
      {:ok, versions} -> json(conn, %{versions: versions})
      {:error, _} -> {:error, :fetch_versions_failed}
    end
  end

  def info(conn, _params) do
    range = Application.get_env(:allay, :mc_port_range, 25_565..25_575)

    json(conn, %{
      platform: to_string(:os.type() |> elem(1)),
      arch: to_string(:erlang.system_info(:system_architecture)),
      # os_mon is intentionally not a dependency; total RAM is not surfaced
      # (the React client only reads portRange). Left as 0 for parity shape.
      totalRamMb: 0,
      cpuCount: System.schedulers_online(),
      portRange: %{min: range.first, max: range.last},
      javaMajors: JavaRegistry.runtimes() |> Map.keys() |> Enum.sort()
    })
  end
end
