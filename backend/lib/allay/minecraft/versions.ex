defmodule Allay.Minecraft.Versions do
  @moduledoc """
  Mojang and PaperMC version APIs. The Java requirement for any version
  (including Paper) comes from the Mojang per-version metadata — there
  is no static version→Java table to maintain.
  """

  @mojang_manifest_url "https://launchermeta.mojang.com/mc/game/version_manifest.json"
  @paper_api_base "https://api.papermc.io/v2"
  @list_limit 20

  def available_versions(:vanilla) do
    with {:ok, manifest} <- get_json(@mojang_manifest_url) do
      {:ok,
       manifest["versions"]
       |> Enum.filter(&(&1["type"] == "release"))
       |> Enum.take(@list_limit)
       |> Enum.map(& &1["id"])}
    end
  end

  def available_versions(:paper) do
    with {:ok, body} <- get_json("#{@paper_api_base}/projects/paper") do
      {:ok, body["versions"] |> Enum.reverse() |> Enum.take(@list_limit)}
    end
  end

  def required_java_major(type, version) do
    with {:ok, manifest} <- get_json(@mojang_manifest_url) do
      try_candidates(manifest, manifest_candidates(type, version), nil)
    end
  end

  # Parity with the TS jar-manager: the error from the LAST tried
  # candidate is the one surfaced.
  defp try_candidates(_manifest, [], last_error), do: last_error

  defp try_candidates(manifest, [candidate | rest], _last_error) do
    case java_major_for(manifest, candidate) do
      {:ok, major} -> {:ok, major}
      {:error, _} = error -> try_candidates(manifest, rest, error)
    end
  end

  def download_spec(:vanilla, version) do
    with {:ok, manifest} <- get_json(@mojang_manifest_url),
         {:ok, entry} <- manifest_entry(manifest, version),
         {:ok, meta} <- get_json(entry["url"]),
         %{"url" => url} = server <- get_in(meta, ["downloads", "server"]) do
      {:ok, %{url: url, sha1: server["sha1"]}}
    else
      nil -> {:error, "No server download in Mojang metadata for #{version}"}
      %{} -> {:error, "No server download in Mojang metadata for #{version}"}
      {:error, _} = error -> error
    end
  end

  def download_spec(:paper, version) do
    builds_url = "#{@paper_api_base}/projects/paper/versions/#{version}/builds"

    with {:ok, %{"builds" => builds}} when builds != [] <- get_json(builds_url),
         %{"build" => build} <- List.last(builds),
         build_url = "#{builds_url}/#{build}",
         {:ok, info} <- get_json(build_url),
         %{"name" => jar_name} <- get_in(info, ["downloads", "application"]) do
      {:ok, %{url: "#{build_url}/downloads/#{jar_name}", sha1: nil}}
    else
      {:ok, %{"builds" => []}} -> {:error, "No builds found for Paper #{version}"}
      {:ok, _} -> {:error, "No builds found for Paper #{version}"}
      nil -> {:error, "No download found for Paper #{version}"}
      {:error, _} = error -> error
    end
  end

  defp manifest_candidates(:vanilla, version), do: [version]

  defp manifest_candidates(:paper, version),
    do: Enum.uniq([version, String.replace(version, ~r/-(pre|rc)\d+$/, "")])

  defp manifest_entry(manifest, version) do
    case Enum.find(manifest["versions"], &(&1["id"] == version)) do
      nil -> {:error, "Version #{version} not found in Mojang manifest"}
      entry -> {:ok, entry}
    end
  end

  defp java_major_for(manifest, version) do
    with {:ok, entry} <- manifest_entry(manifest, version),
         {:ok, meta} <- get_json(entry["url"]) do
      case get_in(meta, ["javaVersion", "majorVersion"]) do
        major when is_integer(major) -> {:ok, major}
        _ -> {:error, "Mojang manifest for #{version} has no javaVersion.majorVersion"}
      end
    end
  end

  defp get_json(url) do
    options = Application.get_env(:allay, :minecraft_req_options, [])

    request =
      Req.new(
        url: url,
        headers: [{"user-agent", "MC-Manager/1.0"}, {"accept", "application/json"}]
      )
      |> Req.merge(options)

    case Req.get(request) do
      {:ok, %{status: 200, body: body}} -> {:ok, body}
      {:ok, %{status: status}} -> {:error, "Request to #{url} failed with status #{status}"}
      {:error, exception} -> {:error, "Request to #{url} failed: #{Exception.message(exception)}"}
    end
  end
end
