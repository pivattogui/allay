defmodule Allay.Imports.Analyzer do
  @moduledoc """
  Inspects an uploaded archive (`.zip` / `.tar.gz` / `.tgz`) and reports which
  Minecraft artifacts it contains, the detected layout, a suggested import
  preset, and the archive size.

  This is a behavioral port of the legacy `import/analyzer.ts`. Entry listing
  uses native OTP (`:zip.list_dir` and `:erl_tar.table`) instead of the legacy
  `unzip -l` stdout parsing / `tar.list` — no shell-outs.

  Directory-entry convention: directory entries end with `"/"`. `:zip.list_dir`
  reports a `:file_info` per member; OS-built zips carry explicit directory
  records (type `:directory`) which are normalized to a trailing slash.
  `:erl_tar.table/2` only returns plain names, so it is called with the
  `:verbose` flag to obtain per-entry types and directory entries get the
  trailing slash appended.
  """

  @world_patterns ~w(world/ world_nether/ world_the_end/)

  @world_component_files ~w(
    level.dat level.dat_old session.lock raids.dat scoreboard.dat
    forcedchunks.dat icon.png
  )

  @world_component_dirs ~w(
    region/ entities/ poi/ data/ playerdata/ advancements/ stats/
    datapacks/ serverconfig/ DIM-1/ DIM1/
  )

  @config_patterns ~w(
    server.properties bukkit.yml spigot.yml
    config/paper-global.yml config/paper-world-defaults.yml
  )

  @config_extensions ~w(.yml .yaml .toml .properties)

  @log_patterns ~w(logs/ crash-reports/)

  @plugin_pattern "plugins/"

  @type categories :: %{
          world: [String.t()],
          configs: [String.t()],
          plugins: [String.t()],
          jars: [String.t()],
          logs: [String.t()],
          other: [String.t()]
        }

  @doc """
  Lists archive entries with directory entries normalized to a trailing slash.
  """
  @spec list_entries(String.t()) :: {:ok, [String.t()]} | {:error, term()}
  def list_entries(archive_path) do
    if String.ends_with?(String.downcase(archive_path), ".zip") do
      list_zip_entries(archive_path)
    else
      list_tar_entries(archive_path)
    end
  end

  defp list_zip_entries(archive_path) do
    case :zip.list_dir(to_charlist(archive_path)) do
      {:ok, records} ->
        entries =
          records
          |> Enum.flat_map(&zip_entry_name/1)

        {:ok, entries}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp zip_entry_name({:zip_file, name, file_info, _comment, _offset, _comp_size}) do
    name = to_string(name)

    case file_info do
      {:file_info, _, :directory, _, _, _, _, _, _, _, _, _, _, _} ->
        [ensure_trailing_slash(name)]

      _ ->
        [name]
    end
  end

  defp zip_entry_name(_other), do: []

  defp list_tar_entries(archive_path) do
    case :erl_tar.table(to_charlist(archive_path), [:compressed, :verbose]) do
      {:ok, records} ->
        entries = Enum.map(records, &tar_entry_name/1)
        {:ok, entries}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp tar_entry_name({name, :directory, _size, _mtime, _mode, _uid, _gid}) do
    ensure_trailing_slash(to_string(name))
  end

  defp tar_entry_name({name, _type, _size, _mtime, _mode, _uid, _gid}) do
    to_string(name)
  end

  defp ensure_trailing_slash(name) do
    if String.ends_with?(name, "/"), do: name, else: name <> "/"
  end

  @doc """
  Normalizes a raw entry list: drops `__MACOSX*` artifacts and strips a single
  shared root component when every entry shares one.
  """
  @spec normalize([String.t()]) :: [String.t()]
  def normalize(raw) do
    raw
    |> strip_macosx()
    |> strip_single_root()
  end

  defp strip_macosx(entries), do: Enum.reject(entries, &String.starts_with?(&1, "__MACOSX"))

  defp strip_single_root(entries) do
    case Enum.reject(entries, &(&1 == "" or &1 == "./")) do
      [] -> entries
      [first | _] = non_empty -> strip_shared_root(entries, non_empty, root_component(first))
    end
  end

  defp strip_shared_root(entries, non_empty, root) do
    if Enum.all?(non_empty, &(root_component(&1) == root)) do
      Enum.map(non_empty, &strip_root_prefix(&1, root))
    else
      entries
    end
  end

  defp root_component(entry), do: entry |> String.split("/") |> hd()

  defp strip_root_prefix(entry, root) do
    without_root = String.slice(entry, String.length(root)..-1//1)

    case without_root do
      "/" <> rest -> rest
      other -> other
    end
  end

  @doc """
  Categorizes entries into world/configs/plugins/jars/logs/other. World entries
  are collected as deduplicated directory prefixes (or, for a bare-world layout,
  the real root component prefixes), never as individual files.
  """
  @spec categorize([String.t()]) :: categories()
  def categorize(entries) do
    bare_world = detect_bare_world_prefixes(entries)

    initial = %{
      world: MapSet.new(bare_world),
      configs: [],
      plugins: [],
      jars: [],
      logs: [],
      other: [],
      seen_world_dirs: MapSet.new()
    }

    acc = Enum.reduce(entries, initial, &categorize_entry(&1, &2, bare_world))

    %{
      world: MapSet.to_list(acc.world),
      configs: Enum.reverse(acc.configs),
      plugins: Enum.reverse(acc.plugins),
      jars: Enum.reverse(acc.jars),
      logs: Enum.reverse(acc.logs),
      other: Enum.reverse(acc.other)
    }
  end

  defp categorize_entry(entry, acc, bare_world) do
    if claimed_by_bare_world?(entry, bare_world) do
      acc
    else
      place_entry(entry, acc)
    end
  end

  # Categorization order is load-bearing (legacy parity): world prefixes →
  # plugins → logs → root jars → exact configs → root config-ext → config/
  # subdir config-ext → remaining root-level → dropped.
  defp place_entry(entry, acc) do
    cond do
      world_pattern = Enum.find(@world_patterns, &String.starts_with?(entry, &1)) ->
        add_world_prefix(acc, world_pattern)

      String.starts_with?(entry, @plugin_pattern) ->
        prepend(acc, :plugins, entry)

      Enum.any?(@log_patterns, &String.starts_with?(entry, &1)) ->
        prepend(acc, :logs, entry)

      config?(entry) ->
        prepend(acc, :configs, entry)

      root_jar?(entry) ->
        prepend(acc, :jars, entry)

      root_level?(entry) ->
        prepend(acc, :other, entry)

      true ->
        acc
    end
  end

  defp root_jar?(entry), do: root_level?(entry) and String.ends_with?(entry, ".jar")

  defp config?(entry) do
    cond do
      entry in @config_patterns -> true
      root_level?(entry) and config_extension?(entry) -> true
      String.starts_with?(entry, "config/") and config_extension?(entry) -> true
      true -> false
    end
  end

  defp add_world_prefix(acc, pattern) do
    if MapSet.member?(acc.seen_world_dirs, pattern) do
      acc
    else
      %{
        acc
        | world: MapSet.put(acc.world, pattern),
          seen_world_dirs: MapSet.put(acc.seen_world_dirs, pattern)
      }
    end
  end

  defp prepend(acc, key, value), do: Map.update!(acc, key, &[value | &1])

  defp config_extension?(entry), do: Enum.any?(@config_extensions, &String.ends_with?(entry, &1))

  # Root-level: no path separator once a trailing directory slash is dropped.
  defp root_level?(entry) do
    entry
    |> String.trim_trailing("/")
    |> String.contains?("/")
    |> Kernel.not()
  end

  defp detect_bare_world_prefixes(entries) do
    if Enum.member?(entries, "level.dat") do
      Enum.reduce(entries, MapSet.new(), &claim_world_component/2)
    else
      MapSet.new()
    end
  end

  defp claim_world_component(entry, prefixes) do
    cond do
      entry in @world_component_files ->
        MapSet.put(prefixes, entry)

      dir = Enum.find(@world_component_dirs, &String.starts_with?(entry, &1)) ->
        MapSet.put(prefixes, dir)

      true ->
        prefixes
    end
  end

  defp claimed_by_bare_world?(entry, prefixes) do
    cond do
      MapSet.size(prefixes) == 0 ->
        false

      MapSet.member?(prefixes, entry) ->
        true

      true ->
        Enum.any?(prefixes, fn p ->
          String.ends_with?(p, "/") and String.starts_with?(entry, p)
        end)
    end
  end

  @doc """
  Detects the archive layout from its categories and entries:
  `"full-backup"` / `"world-only"` / `"mixed"`. Accepts `{categories, entries}`.
  """
  @spec classify({categories(), [String.t()]}) :: String.t()
  def classify({categories, entries}) do
    has_level_dat =
      Enum.any?(entries, &(&1 == "level.dat" or String.ends_with?(&1, "/level.dat")))

    has_world_dirs = categories.world != []
    has_server_properties = "server.properties" in categories.configs

    cond do
      (has_level_dat or has_world_dirs) and has_server_properties -> "full-backup"
      has_level_dat or has_world_dirs -> "world-only"
      true -> "mixed"
    end
  end

  @doc """
  Suggests an import preset for a detected type, or `nil` for `"mixed"`.
  """
  @spec suggest_preset(String.t()) :: String.t() | nil
  def suggest_preset("world-only"), do: "world-only"
  def suggest_preset("full-backup"), do: "world-configs"
  def suggest_preset(_), do: nil

  @doc """
  Full analysis of an archive: lists + normalizes entries, categorizes them,
  classifies the layout, suggests a preset, and reports the archive file size.
  """
  @spec analyze(String.t()) ::
          {:ok,
           %{
             detected_type: String.t(),
             categories: categories(),
             suggested_preset: String.t() | nil,
             total_size: non_neg_integer(),
             entries: [String.t()]
           }}
          | {:error, term()}
  def analyze(archive_path) do
    with {:ok, raw} <- list_entries(archive_path) do
      entries = normalize(raw)
      categories = categorize(entries)
      detected_type = classify({categories, entries})

      {:ok,
       %{
         detected_type: detected_type,
         categories: categories,
         suggested_preset: suggest_preset(detected_type),
         total_size: File.stat!(archive_path).size,
         entries: entries
       }}
    end
  end
end
