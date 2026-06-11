defmodule Allay.Minecraft.JarCache do
  @moduledoc """
  Content cache for server JARs at `{data_dir}/jars/{type}/{version}.jar`.
  Downloads land in a temp file and are renamed in only after the sha1
  matches (when provided) — a corrupted or interrupted download never
  becomes a cache hit.
  """

  def fetch(type, version, %{url: url, sha1: sha1}, opts \\ []) do
    path = jar_path(type, version, opts)

    if File.exists?(path) do
      {:ok, path}
    else
      download(url, sha1, path)
    end
  end

  def local_path(type, version, opts \\ []) do
    path = jar_path(type, version, opts)
    if File.exists?(path), do: path, else: nil
  end

  defp jar_path(type, version, opts) do
    data_dir = Keyword.get(opts, :data_dir) || Application.fetch_env!(:allay, :data_dir)
    Path.join([data_dir, "jars", to_string(type), "#{version}.jar"])
  end

  defp download(url, expected_sha1, path) do
    File.mkdir_p!(Path.dirname(path))
    temp_path = path <> ".part"
    options = Application.get_env(:allay, :minecraft_req_options, [])

    request = Req.new(url: url, headers: [{"user-agent", "MC-Manager/1.0"}]) |> Req.merge(options)

    with {:ok, %{status: 200, body: body}} <- Req.get(request),
         :ok <- verify_sha1(body, expected_sha1) do
      File.write!(temp_path, body)
      File.rename!(temp_path, path)
      {:ok, path}
    else
      {:ok, %{status: status}} ->
        {:error, "Failed to download JAR: status #{status}"}

      {:error, %Req.TransportError{} = e} ->
        {:error, "Failed to download JAR: #{Exception.message(e)}"}

      {:error, message} when is_binary(message) ->
        {:error, message}
    end
  end

  defp verify_sha1(_body, nil), do: :ok

  defp verify_sha1(body, expected) do
    actual = :crypto.hash(:sha, body) |> Base.encode16(case: :lower)

    if actual == String.downcase(expected) do
      :ok
    else
      {:error, "JAR sha1 mismatch: expected #{expected}, got #{actual}"}
    end
  end
end
