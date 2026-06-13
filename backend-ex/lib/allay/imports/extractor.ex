defmodule Allay.Imports.Extractor do
  @moduledoc """
  Resolves an import selection into archive paths and extracts only those paths
  into a server directory, using native OTP (`:erl_tar` / `:zip`) — no shell-outs.

  Behavioral port of the legacy `import/extractor.ts`. Two safety deltas over
  the legacy:

    * Non-regular entries (symlinks, hardlinks, devices) are never extracted.
      `:erl_tar` is filtered to the regular entries selected; `:zip` cannot
      preserve symlinks at all (it materializes them as a regular file whose
      content is the link target), so a zipped symlink cannot escape the sandbox.
    * Every selected path is re-validated through `Allay.Files.PathSandbox`
      before extraction; any path resolving outside `server_dir` aborts the
      whole import.

  World-wrap: a bare `level.dat` at the archive root (no selected path under
  `world/`) means the archive was exported directly from a world directory, so
  the selection is extracted under `server_dir/world/`.
  """

  alias Allay.Files.PathSandbox
  alias Allay.Imports.Analyzer

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
  @spec extract_selection(String.t(), [String.t()], [String.t()], String.t()) ::
          {:ok, [String.t()]} | {:error, term()}
  def extract_selection(_archive_path, _original_entries, [], _server_dir), do: {:ok, []}

  def extract_selection(archive_path, original_entries, selected_paths, server_dir) do
    needs_wrap = world_wrap?(original_entries, selected_paths)
    dest_rels = Enum.map(selected_paths, &wrapped_rel(&1, needs_wrap))

    with :ok <- reject_unsafe_entries(selected_paths),
         :ok <- validate_destinations(dest_rels, server_dir) do
      do_extract(archive_path, selected_paths, server_dir, needs_wrap)
    end
  end

  # The extractors below write entries by their RAW archive name (`:files`/
  # `:file_list` + `File.cp_r!`), so any traversal in the name escapes the
  # sandbox even though `validate_destinations/2` sanitizes before checking.
  # A legitimate archive entry never needs `..` or a leading slash; refuse the
  # whole import on any that does. `:erl_tar` guards itself, but `:zip` does
  # not — this closes the zip path and removes the false safety of validating
  # a sanitized form while extracting the raw one.
  defp reject_unsafe_entries(selected_paths) do
    if Enum.all?(selected_paths, &safe_entry?/1),
      do: :ok,
      else: {:error, :invalid_path}
  end

  defp safe_entry?(path) do
    path == PathSandbox.sanitize(path)
  end

  defp world_wrap?(original_entries, selected_paths) do
    "level.dat" in original_entries and
      not Enum.any?(selected_paths, &String.starts_with?(&1, "world/"))
  end

  defp wrapped_rel(path, true), do: Path.join("world", path)
  defp wrapped_rel(path, false), do: path

  # Re-validate every destination through the sandbox. The server dir must exist
  # (PathSandbox.resolve requires it); the orchestration creates it beforehand.
  defp validate_destinations(dest_rels, server_dir) do
    Enum.reduce_while(dest_rels, :ok, fn rel, :ok ->
      case PathSandbox.resolve(server_dir, rel) do
        {:ok, _full, _rel} -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp do_extract(archive_path, selected_paths, server_dir, needs_wrap) do
    File.mkdir_p!(server_dir)

    if zip?(archive_path) do
      extract_zip(archive_path, selected_paths, server_dir, needs_wrap)
    else
      extract_tar(archive_path, selected_paths, server_dir, needs_wrap)
    end
  end

  defp zip?(path), do: String.ends_with?(String.downcase(path), ".zip")

  # ── tar ──────────────────────────────────────────────────────────────────

  defp extract_tar(archive_path, selected_paths, server_dir, false) do
    files = Enum.map(selected_paths, &to_charlist/1)

    case :erl_tar.extract(to_charlist(archive_path), [
           :compressed,
           {:cwd, to_charlist(server_dir)},
           {:files, files}
         ]) do
      :ok -> {:ok, selected_paths}
      {:error, reason} -> {:error, reason}
    end
  end

  defp extract_tar(archive_path, selected_paths, server_dir, true) do
    temp = mkdtemp(server_dir, "tar-extract-")

    try do
      files = Enum.map(selected_paths, &to_charlist/1)

      case :erl_tar.extract(to_charlist(archive_path), [
             :compressed,
             {:cwd, to_charlist(temp)},
             {:files, files}
           ]) do
        :ok -> move_under_world(temp, server_dir, selected_paths)
        {:error, reason} -> {:error, reason}
      end
    after
      File.rm_rf(temp)
    end
  end

  # ── zip ────────────────────────────────────────────────────────────────────

  defp extract_zip(archive_path, selected_paths, server_dir, needs_wrap) do
    temp = mkdtemp(server_dir, "zip-extract-")

    try do
      file_list = Enum.map(selected_paths, &to_charlist/1)

      case :zip.extract(to_charlist(archive_path), [
             {:cwd, to_charlist(temp)},
             {:file_list, file_list}
           ]) do
        {:ok, _files} -> place_zip_output(temp, server_dir, selected_paths, needs_wrap)
        {:error, reason} -> {:error, reason}
      end
    after
      File.rm_rf(temp)
    end
  end

  defp place_zip_output(temp, server_dir, selected_paths, needs_wrap) do
    base = if needs_wrap, do: Path.join(server_dir, "world"), else: server_dir

    Enum.each(selected_paths, fn rel ->
      src = Path.join(temp, rel)
      dest = Path.join(base, rel)
      if File.exists?(src), do: copy_into(src, dest)
    end)

    {:ok, Enum.map(selected_paths, &wrapped_rel(&1, needs_wrap))}
  end

  # ── shared helpers ─────────────────────────────────────────────────────────

  defp move_under_world(temp, server_dir, selected_paths) do
    world_dir = Path.join(server_dir, "world")

    Enum.each(selected_paths, fn rel ->
      src = Path.join(temp, rel)
      dest = Path.join(world_dir, rel)
      if File.exists?(src), do: copy_into(src, dest)
    end)

    {:ok, Enum.map(selected_paths, &Path.join("world", &1))}
  end

  defp copy_into(src, dest) do
    File.mkdir_p!(Path.dirname(dest))
    File.cp_r!(src, dest)
  end

  defp mkdtemp(parent, prefix) do
    dir = Path.join(parent, "#{prefix}#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    dir
  end
end
