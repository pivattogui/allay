defmodule Allay.Servers.JavaGate do
  @moduledoc """
  Decides whether a server's required Java major is installed, before any
  filesystem work happens during provisioning. Wraps the Mojang per-version
  Java lookup and the installed-runtimes registry into tagged error tuples
  the FallbackController maps to HTTP codes.
  """

  alias Allay.Minecraft.Versions
  alias Allay.Servers.JavaRegistry

  @doc """
  Resolves the required Java major for a server type/version.

  `{:ok, major}` on success, `{:error, {:java_lookup_failed, message}}` when
  the Mojang metadata cannot be read.
  """
  def required_major(type, version) do
    case Versions.required_java_major(type_atom(type), version) do
      {:ok, major} -> {:ok, major}
      {:error, message} -> {:error, {:java_lookup_failed, message}}
    end
  end

  @doc """
  Asserts a compatible runtime is installed for the server's required major.

  `{:ok, major}` when a runtime is available, `{:error, {:java_lookup_failed,
  message}}` when the major cannot be determined, and `{:error,
  {:java_runtime_unavailable, message}}` when no installed runtime satisfies
  it (message carries the installed majors for parity with the legacy backend).
  """
  def assert_available(type, version) do
    with {:ok, major} <- required_major(type, version) do
      case JavaRegistry.find_compatible(major) do
        {_major, _path} -> {:ok, major}
        nil -> {:error, {:java_runtime_unavailable, unavailable_message(type, version, major)}}
      end
    end
  end

  defp unavailable_message(type, version, major) do
    "Server #{type}/#{version} requires Java #{major}, but only [#{installed_list()}] are installed"
  end

  defp installed_list do
    case JavaRegistry.runtimes() |> Map.keys() |> Enum.sort() do
      [] -> "none"
      majors -> Enum.join(majors, ", ")
    end
  end

  defp type_atom(type) when is_atom(type), do: type
  defp type_atom("vanilla"), do: :vanilla
  defp type_atom("paper"), do: :paper
end
