defmodule AllayWeb.EndpointConfig do
  @moduledoc "Derives Endpoint host/check_origin from ALLAY_PUBLIC_ORIGIN (pure, testable)."

  @doc """
  Given the ALLAY_PUBLIC_ORIGIN value (or nil), returns `{host, check_origin}`.

      iex> origin(nil)
      {"localhost", false}

      iex> origin("")
      {"localhost", false}

      iex> origin("https://allay.example")
      {"allay.example", ["https://allay.example"]}

      iex> origin("http://10.0.0.5:8080")
      {"10.0.0.5", ["http://10.0.0.5:8080"]}

  A scheme-less value has no `URI.host`, so the whole string is treated as the
  host: `"allay.local"` → `{"allay.local", ["allay.local"]}`.
  """
  def origin(nil), do: {"localhost", false}
  def origin(""), do: {"localhost", false}

  def origin(public_origin) when is_binary(public_origin) do
    uri = URI.parse(public_origin)
    host = uri.host || public_origin
    {host, [public_origin]}
  end
end
