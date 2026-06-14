defmodule Allay.Imports.Session do
  @moduledoc """
  Temporary storage for an uploaded import archive.

  An archive is staged under `{data_dir}/temp/import-{uuid}/{original_filename}`.
  Sessions expire 30 minutes after their directory's mtime; an expired directory
  is deleted the moment it is accessed (`archive_path/2`) or swept (`sweep/1`).

  The legacy `import/analyzer.ts` keyed sessions by `crypto.randomUUID()` and
  read the single file back from the dir; this mirrors that contract via
  `Ecto.UUID` and the same 30-minute TTL.

  `data_dir` resolves through the usual `opts[:data_dir]` seam, falling back to
  the configured `:allay, :data_dir` (tests pass a tmp dir).
  """

  @import_prefix "import-"
  @ttl_seconds 30 * 60

  @doc """
  Stages an upload under a fresh `import-{uuid}` directory and returns
  `{:ok, import_id}`.

  `source` is one of `{:file, path}` (copied from disk — e.g. a `Plug.Upload`),
  `{:binary, content}`, or a bare binary treated as content.
  """
  @spec create({:file, String.t()} | {:binary, binary()} | binary(), String.t(), keyword()) ::
          {:ok, String.t()}
  def create(source, original_filename, opts \\ []) do
    import_id = Ecto.UUID.generate()
    import_dir = import_dir(import_id, opts)
    File.mkdir_p!(import_dir)

    dest = Path.join(import_dir, Path.basename(original_filename))
    write_source(source, dest)

    {:ok, import_id}
  end

  defp write_source({:file, src}, dest), do: File.cp!(src, dest)
  defp write_source({:binary, content}, dest), do: File.write!(dest, content)
  defp write_source(content, dest) when is_binary(content), do: File.write!(dest, content)

  @doc """
  Resolves the staged archive path for `import_id`.

  Returns `{:error, :import_not_found}` when the directory is missing, empty, or
  expired (mtime older than 30 minutes). An expired directory is deleted before
  returning.
  """
  @spec archive_path(String.t(), keyword()) :: {:ok, String.t()} | {:error, :import_not_found}
  def archive_path(import_id, opts \\ []) do
    import_dir = import_dir(import_id, opts)

    cond do
      not File.dir?(import_dir) ->
        {:error, :import_not_found}

      expired?(import_dir) ->
        File.rm_rf(import_dir)
        {:error, :import_not_found}

      true ->
        case File.ls!(import_dir) do
          [first | _] -> {:ok, Path.join(import_dir, first)}
          [] -> {:error, :import_not_found}
        end
    end
  end

  @doc """
  Deletes all expired `import-*` directories under `{data_dir}/temp`. A no-op
  when the temp directory does not exist.
  """
  @spec sweep(keyword()) :: :ok
  def sweep(opts \\ []) do
    temp = temp_dir(opts)

    if File.dir?(temp) do
      temp
      |> File.ls!()
      |> Enum.filter(&String.starts_with?(&1, @import_prefix))
      |> Enum.map(&Path.join(temp, &1))
      |> Enum.each(&remove_if_expired/1)
    end

    :ok
  end

  defp remove_if_expired(dir) do
    if expired?(dir), do: File.rm_rf(dir)
  end

  @doc """
  Begins a streaming upload: creates a fresh `import-{uuid}` directory and
  returns `{:ok, import_id, dest_path}` for the caller to stream the archive
  into. Only the basename of `filename` is used (path-traversal safe).
  """
  @spec start_upload(String.t(), keyword()) :: {:ok, String.t(), String.t()}
  def start_upload(filename, opts \\ []) do
    import_id = Ecto.UUID.generate()
    dir = import_dir(import_id, opts)
    File.mkdir_p!(dir)
    dest = Path.join(dir, Path.basename(filename))
    {:ok, import_id, dest}
  end

  @doc """
  Removes the session directory for `import_id`. Idempotent.
  """
  @spec delete(String.t(), keyword()) :: :ok
  def delete(import_id, opts \\ []) do
    File.rm_rf(import_dir(import_id, opts))
    :ok
  end

  defp expired?(dir) do
    case File.stat(dir, time: :posix) do
      {:ok, %File.Stat{mtime: mtime}} -> System.os_time(:second) - mtime > @ttl_seconds
      {:error, _} -> true
    end
  end

  defp import_dir(import_id, opts) do
    Path.join(temp_dir(opts), "#{@import_prefix}#{import_id}")
  end

  defp temp_dir(opts) do
    Path.join(data_dir(opts), "temp")
  end

  defp data_dir(opts) do
    Keyword.get(opts, :data_dir) || Application.fetch_env!(:allay, :data_dir)
  end
end
