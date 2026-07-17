defmodule AllayWeb.EndpointConfig do
  @moduledoc "Derives the backend host from its public origin."

  @doc """
  Returns the host component of `ALLAY_PUBLIC_ORIGIN`.

      iex> backend_host(nil)
      "localhost"

      iex> backend_host("")
      "localhost"

      iex> backend_host("https://api.allay.example")
      "api.allay.example"

      iex> backend_host("http://10.0.0.5:8080")
      "10.0.0.5"

  A scheme-less value has no `URI.host`, so the whole string is treated as the
  host.
  """
  def backend_host(nil), do: "localhost"
  def backend_host(""), do: "localhost"

  def backend_host(public_origin) when is_binary(public_origin) do
    uri = URI.parse(public_origin)
    uri.host || public_origin
  end
end
