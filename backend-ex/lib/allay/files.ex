defmodule Allay.Files do
  @moduledoc """
  Filesystem operations for the server file browser/editor surface, ported from
  legacy `routes/files.ts`. Every public function takes `%Allay.Accounts.Scope{}`
  first (Phoenix 1.8 convention), loads the server row, and re-validates the
  caller-supplied relative path through `Allay.Files.PathSandbox` against the
  server's on-disk `directory`. The legacy error codes survive verbatim as typed
  atoms; the controller maps them back to the exact HTTP codes/messages.
  """

  alias Allay.Accounts.Scope
  alias Allay.Files.PathSandbox
  alias Allay.Servers

  # Files larger than this are never inlined into the editor response.
  @max_editable_size 1_048_576

  @doc """
  Lists directory entries under `rel`. Returns `{:ok, %{path, entries}}` where
  `path` is the sanitized rel (root reported as `"/"`). Dirs sort first, then
  by name ascending; entries that cannot be stat'd are skipped.
  """
  def list_entries(%Scope{} = scope, server_id, rel \\ "") do
    with {:ok, full, sanitized} <- resolve(scope, server_id, rel) do
      cond do
        not File.exists?(full) -> {:error, :directory_not_found}
        not File.dir?(full) -> {:error, :not_a_directory}
        true -> {:ok, %{path: rel_or_root(sanitized), entries: build_entries(full)}}
      end
    end
  end

  @doc """
  Reads a file as `:utf8` or `:base64`. Files over 1 MiB return `too_large`;
  non-editable files requested as utf8 return a `nil` content with an editor
  message; base64 bypasses the editable gate.
  """
  def read_file(%Scope{} = scope, server_id, rel, encoding) when encoding in [:utf8, :base64] do
    with {:ok, full, sanitized} <- resolve(scope, server_id, rel) do
      cond do
        not File.exists?(full) -> {:error, :file_not_found}
        File.dir?(full) -> {:error, :is_directory}
        true -> read_existing_file(full, sanitized, encoding)
      end
    end
  end

  @doc """
  Writes `content` to `rel`, creating parent directories. Overwrites silently.
  Returns `{:ok, %{path, size, sensitive}}` or `{:error, :write_error}`.
  """
  def write_file(%Scope{} = scope, server_id, rel, content) do
    with {:ok, full, sanitized} <- resolve(scope, server_id, rel) do
      with :ok <- File.mkdir_p(Path.dirname(full)),
           :ok <- File.write(full, content) do
        {:ok,
         %{
           path: sanitized,
           size: byte_size(content),
           sensitive: PathSandbox.sensitive?(full)
         }}
      else
        _ -> {:error, :write_error}
      end
    end
  end

  @doc """
  Creates the directory `rel` (recursive). Empty sanitized name is rejected.
  """
  def mkdir(%Scope{} = scope, server_id, rel) do
    with {:ok, full, sanitized} <- resolve(scope, server_id, rel) do
      cond do
        sanitized == "" -> {:error, :name_required}
        File.exists?(full) -> {:error, :already_exists}
        true -> create_dir(full, sanitized)
      end
    end
  end

  @doc """
  Recursively deletes `rel`. The sandbox root cannot be deleted. Captures the
  entry type before removal for the response.
  """
  def delete_path(%Scope{} = scope, server_id, rel) do
    with {:ok, full, sanitized} <- resolve(scope, server_id, rel) do
      cond do
        sanitized == "" -> {:error, :cannot_delete_root}
        not File.exists?(full) -> {:error, :path_not_found}
        true -> remove_path(full, sanitized)
      end
    end
  end

  @doc """
  Renames (moves) `old_rel` to `new_rel`. Both paths are validated independently;
  destination parents are created so this doubles as a move.
  """
  def rename_path(%Scope{} = scope, server_id, old_rel, new_rel) do
    with {:ok, server} <- Servers.get_server(scope, server_id),
         {:ok, old_full, old_san} <- resolve_old(server.directory, old_rel),
         {:ok, new_full, new_san} <- resolve_new(server.directory, new_rel) do
      cond do
        not File.exists?(old_full) -> {:error, :source_not_found}
        File.exists?(new_full) -> {:error, :destination_exists}
        true -> move_path(old_full, new_full, old_san, new_san)
      end
    end
  end

  @doc """
  Validates `rel` for download. Returns `{:ok, full_path, basename}` for files;
  directories are refused (legacy "not yet implemented").
  """
  def download_path(%Scope{} = scope, server_id, rel) do
    with {:ok, full, _sanitized} <- resolve(scope, server_id, rel) do
      cond do
        not File.exists?(full) -> {:error, :file_not_found}
        File.dir?(full) -> {:error, :is_directory_download}
        true -> {:ok, full, Path.basename(full)}
      end
    end
  end

  @doc """
  Saves `uploads` (each `%{filename, path}`) into `rel_dir`, which is created if
  missing. Only the client filename's basename is kept (kills traversal). Any
  copy failure aborts the whole batch with `{:error, :upload_error}`.
  """
  def save_uploads(%Scope{} = scope, server_id, rel_dir, uploads) do
    with {:ok, target, _sanitized} <- resolve(scope, server_id, rel_dir),
         :ok <- ensure_target_dir(target) do
      copy_uploads(target, uploads)
    end
  end

  # Shared server-row + sandbox guard. Returns {:ok, full, sanitized_rel} or the
  # pass-through error from either layer.
  defp resolve(%Scope{} = scope, server_id, rel) do
    with {:ok, server} <- Servers.get_server(scope, server_id) do
      PathSandbox.resolve(server.directory, rel)
    end
  end

  defp resolve_old(dir, rel) do
    case PathSandbox.resolve(dir, rel) do
      {:ok, full, san} -> {:ok, full, san}
      {:error, :invalid_path} -> {:error, :invalid_old_path}
    end
  end

  defp resolve_new(dir, rel) do
    case PathSandbox.resolve(dir, rel) do
      {:ok, full, san} -> {:ok, full, san}
      {:error, :invalid_path} -> {:error, :invalid_new_path}
    end
  end

  defp rel_or_root(""), do: "/"
  defp rel_or_root(sanitized), do: sanitized

  defp build_entries(dir) do
    dir
    |> File.ls!()
    |> Enum.flat_map(fn name -> entry(dir, name) end)
    |> Enum.sort(&sort_entry/2)
  end

  defp entry(dir, name) do
    full = Path.join(dir, name)

    case File.stat(full, time: :posix) do
      {:ok, stat} -> [to_entry(name, stat)]
      # Unstat-able items are silently skipped (legacy behavior).
      {:error, _} -> []
    end
  end

  defp to_entry(name, %File.Stat{type: :directory} = stat) do
    %{
      name: name,
      type: "directory",
      size: 0,
      modified: DateTime.from_unix!(stat.mtime),
      extension: nil,
      editable: false,
      sensitive: PathSandbox.sensitive?(name),
      file_type: nil
    }
  end

  defp to_entry(name, stat) do
    %{
      name: name,
      type: "file",
      size: stat.size,
      modified: DateTime.from_unix!(stat.mtime),
      extension: extension(name),
      editable: PathSandbox.editable?(name),
      sensitive: PathSandbox.sensitive?(name),
      file_type: PathSandbox.file_type(name)
    }
  end

  defp extension(name) do
    case name |> Path.extname() |> String.downcase() do
      "" -> nil
      ext -> ext
    end
  end

  # Directories first, then case-sensitive name compare. The legacy used
  # localeCompare; a plain compare is the closest dependency-free equivalent and
  # matches for the ASCII filenames the surface deals with.
  defp sort_entry(%{type: "directory"}, %{type: "file"}), do: true
  defp sort_entry(%{type: "file"}, %{type: "directory"}), do: false
  defp sort_entry(%{name: a}, %{name: b}), do: a <= b

  defp read_existing_file(full, sanitized, encoding) do
    stat = File.stat!(full, time: :posix)
    common = file_common(full, sanitized, stat)
    editable = PathSandbox.editable?(full)

    cond do
      stat.size > @max_editable_size ->
        {:ok, Map.merge(common, %{too_large: true, content: nil, encoding: nil})}

      not editable and encoding == :utf8 ->
        {:ok,
         Map.merge(common, %{
           content: nil,
           encoding: nil,
           message: "File is not editable. Use download endpoint."
         })}

      true ->
        raw = File.read!(full)
        {content, enc} = encode(raw, encoding)
        {:ok, Map.merge(common, %{content: content, encoding: enc})}
    end
  end

  defp file_common(full, sanitized, stat) do
    %{
      path: sanitized,
      name: Path.basename(full),
      size: stat.size,
      modified: DateTime.from_unix!(stat.mtime),
      editable: PathSandbox.editable?(full),
      sensitive: PathSandbox.sensitive?(full),
      file_type: PathSandbox.file_type(full)
    }
  end

  defp encode(raw, :base64), do: {Base.encode64(raw), "base64"}
  defp encode(raw, :utf8), do: {raw, "utf8"}

  defp create_dir(full, sanitized) do
    case File.mkdir_p(full) do
      :ok -> {:ok, %{path: sanitized}}
      {:error, _} -> {:error, :mkdir_error}
    end
  end

  defp remove_path(full, sanitized) do
    type = if File.dir?(full), do: "directory", else: "file"

    case File.rm_rf(full) do
      {:ok, _} -> {:ok, %{path: sanitized, type: type}}
      {:error, _, _} -> {:error, :delete_error}
    end
  end

  defp move_path(old_full, new_full, old_san, new_san) do
    with :ok <- File.mkdir_p(Path.dirname(new_full)),
         :ok <- File.rename(old_full, new_full) do
      {:ok, %{old_path: old_san, new_path: new_san}}
    else
      _ -> {:error, :rename_error}
    end
  end

  defp ensure_target_dir(target) do
    cond do
      File.dir?(target) -> :ok
      File.exists?(target) -> {:error, :not_a_directory}
      match?(:ok, File.mkdir_p(target)) -> :ok
      true -> {:error, :upload_error}
    end
  end

  defp copy_uploads(target, uploads) do
    result =
      Enum.reduce_while(uploads, [], fn upload, acc ->
        name = Path.basename(upload.filename)
        dest = Path.join(target, name)

        case File.cp(upload.path, dest) do
          :ok -> {:cont, [%{name: name, size: File.stat!(dest).size} | acc]}
          {:error, _} -> {:halt, :error}
        end
      end)

    case result do
      :error -> {:error, :upload_error}
      uploaded -> {:ok, %{uploaded: Enum.reverse(uploaded), count: length(uploaded)}}
    end
  end
end
