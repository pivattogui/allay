defmodule Allay.Servers.Import.Extractor do
  @moduledoc """
  Resolves an import selection into archive paths and extracts only those paths
  into a server directory, using native OTP (`:erl_tar` / `:zip`) — no shell-outs.

  Behavioral port of the legacy `import/extractor.ts`. Two safety deltas over
  the legacy:

    * Non-regular entries (symlinks, hardlinks, devices) are never extracted.
      `:erl_tar` is filtered to the regular entries selected; `:zip` cannot
      preserve symlinks at all (it materializes them as a regular file whose
      content is the link target), so a zipped symlink cannot escape the sandbox.
    * Every selected path is re-validated through `Allay.Servers.Files.PathSandbox`
      before extraction; any path resolving outside `server_dir` aborts the
      whole import.

  World-wrap: a bare `level.dat` at the archive root (no selected path under
  `world/`) means the archive was exported directly from a world directory, so
  the selection is extracted under `server_dir/world/`.
  """

  alias Allay.Servers.Files.PathSandbox
  alias Allay.Servers.Import.Analyzer

  @preset_categories %{
    "world-only" => [:world],
    "world-configs" => [:world, :configs],
    "all-except-jars" => [:world, :configs, :plugins, :other]
  }

  @doc """
  Resolves a selection into the list of include matchers (preset category
  values plus `selection["include"]`), minus any matching `selection["exclude"]`.

  A matcher ending in `"/"` is a prefix (`starts_with`); otherwise it is exact.
  """
  @spec resolve_selection(Analyzer.categories(), map()) :: [String.t()]
  def resolve_selection(categories, selection) do
    excludes = Map.get(selection, "exclude", [])

    include_matchers(categories, selection)
    |> Enum.reject(&matches_any?(&1, excludes))
  end

  defp include_matchers(categories, selection) do
    case Map.get(selection, "preset") do
      nil ->
        Map.get(selection, "include", [])

      preset ->
        @preset_categories
        |> Map.fetch!(preset)
        |> Enum.flat_map(&Map.fetch!(categories, &1))
    end
  end

  @doc """
  Filters `entries` to those matched by the resolved selection, honoring the
  prefix/exact matcher rule. This is the actual file list handed to
  `extract_selection/4`.
  """
  @spec select_paths(Analyzer.categories(), map(), [String.t()]) :: [String.t()]
  def select_paths(categories, selection, entries) do
    matchers = resolve_selection(categories, selection)
    excludes = Map.get(selection, "exclude", [])

    Enum.filter(entries, fn entry ->
      matches_any?(entry, matchers) and not matches_any?(entry, excludes)
    end)
  end

  defp matches_any?(entry, matchers) do
    Enum.any?(matchers, fn matcher ->
      if String.ends_with?(matcher, "/") do
        String.starts_with?(entry, matcher)
      else
        entry == matcher
      end
    end)
  end

  @doc """
  Extracts `selected_paths` from the archive into `server_dir`.

  `original_entries` is the normalized entry list (used for world-wrap
  detection). Returns `{:ok, imported_paths}` (the relative paths landed under
  `server_dir`) or `{:error, reason}`. A path resolving outside the sandbox
  aborts with `{:error, :invalid_path}`.
  """
  @spec extract_selection(String.t(), [String.t()], [String.t()], String.t(), String.t() | nil) ::
          {:ok, [String.t()]} | {:error, term()}
  def extract_selection(archive_path, original_entries, selected_paths, server_dir, root \\ nil)

  def extract_selection(_archive_path, _original_entries, [], _server_dir, _root), do: {:ok, []}

  def extract_selection(archive_path, original_entries, selected_paths, server_dir, root) do
    needs_wrap = world_wrap?(original_entries, selected_paths)

    # Each selected path is normalized (root stripped). `member` is its name in
    # the archive (root re-prepended); `dest` is where it lands under the server
    # dir (world-wrapped for a bare-world layout). Reading by raw name and
    # writing by dest is what makes a rooted "world/" archive land correctly.
    plan =
      Enum.map(selected_paths, fn path ->
        %{member: prepend_root(path, root), dest: wrapped_rel(path, needs_wrap)}
      end)

    with :ok <- reject_unsafe(plan),
         :ok <- validate_destinations(Enum.map(plan, & &1.dest), server_dir) do
      do_extract(archive_path, plan, server_dir)
    end
  end

  defp prepend_root(path, nil), do: path
  defp prepend_root(path, root), do: root <> "/" <> path

  # Reject only genuine traversal — a `..` segment or an absolute path. Trailing
  # slashes (directory entries like "region/") are safe and must be allowed;
  # checking `path == sanitize(path)` wrongly rejected them.
  defp reject_unsafe(plan) do
    safe? = fn p -> not String.starts_with?(p, "/") and ".." not in String.split(p, "/") end

    if Enum.all?(plan, fn %{member: m, dest: d} -> safe?.(m) and safe?.(d) end),
      do: :ok,
      else: {:error, :invalid_path}
  end

  @doc """
  Whether a bare-world layout (archive root holds `level.dat`) means the
  selection must be placed under `world/`. Exposed so the orchestration clears
  the same destination it will write to.
  """
  @spec needs_world_wrap?([String.t()], [String.t()]) :: boolean()
  def needs_world_wrap?(original_entries, selected_paths) do
    "level.dat" in original_entries and
      not Enum.any?(selected_paths, &String.starts_with?(&1, "world/"))
  end

  defp world_wrap?(original_entries, selected_paths),
    do: needs_world_wrap?(original_entries, selected_paths)

  defp wrapped_rel(path, true), do: Path.join("world", path)
  defp wrapped_rel(path, false), do: path

  # Defense-in-depth: every destination must resolve inside the server dir. The
  # server dir must exist (PathSandbox.resolve requires it); do_extract also
  # ensures it. Combined with reject_unsafe (which catches `..` before sanitize
  # neutralizes it), destinations cannot escape.
  defp validate_destinations(dest_rels, server_dir) do
    File.mkdir_p!(server_dir)

    Enum.reduce_while(dest_rels, :ok, fn rel, :ok ->
      case PathSandbox.resolve(server_dir, rel) do
        {:ok, _full, _rel} -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  # Extract the selected members (raw archive names) into a temp dir on the same
  # filesystem, then move each into place by its destination. Going through temp
  # keeps the raw archive paths intact for the reader while letting us place
  # them at the (possibly world-wrapped) destination.
  defp do_extract(archive_path, plan, server_dir) do
    File.mkdir_p!(server_dir)
    temp = mkdtemp(server_dir, "extract-")

    try do
      with :ok <- extract_members(archive_path, Enum.map(plan, & &1.member), temp) do
        Enum.each(plan, fn %{member: member, dest: dest} ->
          src = Path.join(temp, member)
          if File.exists?(src), do: place(src, Path.join(server_dir, dest))
        end)

        {:ok, Enum.map(plan, & &1.dest)}
      end
    after
      File.rm_rf(temp)
    end
  end

  defp extract_members(archive_path, members, temp) do
    charlists = Enum.map(members, &to_charlist/1)

    if zip?(archive_path) do
      case :zip.extract(to_charlist(archive_path), [
             {:cwd, to_charlist(temp)},
             {:file_list, charlists}
           ]) do
        {:ok, _} -> :ok
        {:error, reason} -> {:error, reason}
      end
    else
      case :erl_tar.extract(to_charlist(archive_path), [
             :compressed,
             {:cwd, to_charlist(temp)},
             {:files, charlists}
           ]) do
        :ok -> :ok
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp zip?(path), do: String.ends_with?(String.downcase(path), ".zip")

  # Move temp → dest. Same filesystem (temp is under server_dir), so rename is
  # O(1) for a multi-GB world; fall back to copy across devices. A parent dir
  # already moved leaves no src — the File.exists? guard skips it.
  defp place(src, dest) do
    File.mkdir_p!(Path.dirname(dest))

    case File.rename(src, dest) do
      :ok -> :ok
      {:error, _} -> File.cp_r!(src, dest)
    end
  end

  defp mkdtemp(parent, prefix) do
    dir = Path.join(parent, "#{prefix}#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    dir
  end
end
