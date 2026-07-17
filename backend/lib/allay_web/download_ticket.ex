defmodule AllayWeb.DownloadTicket do
  @moduledoc false

  @salt "download ticket"
  @max_age_seconds 60

  def issue(_conn, resource, opts \\ []) do
    token = Phoenix.Token.encrypt(AllayWeb.Endpoint, @salt, resource, opts)
    "/api/downloads/#{URI.encode(token)}"
  end

  def verify(_conn, token) do
    case Phoenix.Token.decrypt(AllayWeb.Endpoint, @salt, token, max_age: @max_age_seconds) do
      {:ok, resource} -> {:ok, resource}
      {:error, _reason} -> {:error, :download_not_found}
    end
  end
end
