defmodule Allay.Servers.Files.PathSandbox do
  @moduledoc """
  Pure port of the legacy `file-security.ts`: path sanitization, sandbox
  containment, and the editable/sensitive/file_type flag tables for the file
  browser surface.

  `sanitize/1` strips null bytes, normalizes backslashes to forward slashes,
  drops leading slashes (absolute input becomes relative), and resolves `.`/
  `..` segments — `..` pops one level and silently no-ops at root, so a
  resolved path can never climb above the sandbox root.

  `resolve/2` re-checks containment with a trailing-separator prefix to defeat
  the `/foo` vs `/foobar` sibling-prefix bug, and requires the server dir to
  exist on disk (legacy `fs.existsSync` guard).
  """

  # Editable text extensions (lowercased extname). Legacy also listed
  # `.htaccess`, but `Path.extname(".htaccess")` is "" (dotfile, no extension)
  # so it never matched — dropped here to match real behavior.
  @editable_extensions ~w(
    .properties .yml .yaml .json .txt .cfg .conf .toml .xml .log .md
    .sk .sh .bat .cmd .csv .ini
  )

  @sensitive_files ~w(
    server.jar eula.txt banned-ips.json banned-players.json ops.json whitelist.json
  )

  @config_exts ~w(.properties .yml .yaml .json .toml .xml .cfg .conf .ini)
  @image_exts ~w(.png .jpg .jpeg .gif .webp .bmp .ico)
  @archive_exts ~w(.zip .tar .gz .7z .rar)
  @text_exts ~w(.txt .md .log .sh .bat .cmd .sk .csv)

  @doc """
  Sanitizes a relative path: removes null bytes, normalizes separators, strips
  leading slashes, and resolves `.`/`..` segments. `..` at root is a silent
  no-op, so the result can never escape above the sandbox root.
  """
  @spec sanitize(String.t()) :: String.t()
  def sanitize(input) when is_binary(input) do
    input
    |> String.replace("\0", "")
    |> String.replace("\\", "/")
    |> String.split("/")
    |> Enum.reduce([], fn
      "", acc -> acc
      ".", acc -> acc
      "..", [] -> []
      "..", [_top | rest] -> rest
      segment, acc -> [segment | acc]
    end)
    |> Enum.reverse()
    |> Enum.join("/")
  end

  @doc """
  Resolves `relative` under `server_dir`. The server dir must exist on disk.
  Returns `{:ok, full_path, sanitized_rel}` when the resolved absolute path is
  the server dir or strictly within it (trailing-separator prefix check),
  otherwise `{:error, :invalid_path}`.
  """
  @spec resolve(String.t(), String.t()) ::
          {:ok, String.t(), String.t()} | {:error, :invalid_path}
  def resolve(server_dir, relative) when is_binary(server_dir) and is_binary(relative) do
    if File.dir?(server_dir) do
      sanitized = sanitize(relative)
      full = Path.expand(sanitized, server_dir)

      if within?(full, server_dir) do
        {:ok, full, sanitized}
      else
        {:error, :invalid_path}
      end
    else
      {:error, :invalid_path}
    end
  end

  # Containment with a trailing separator: `${parent}/` defeats the sibling
  # prefix bug (/x/srv vs /x/srv2). Equality covers the root itself.
  defp within?(child, parent) do
    parent_abs = Path.expand(parent)
    child == parent_abs or String.starts_with?(child, parent_abs <> "/")
  end

  @doc """
  Whether `filename` can be edited as text (lowercased extname in the editable
  set).
  """
  @spec editable?(String.t()) :: boolean()
  def editable?(filename) when is_binary(filename) do
    ext(filename) in @editable_extensions
  end

  @doc """
  Whether `filename`'s lowercased basename is in the sensitive set. A
  warning-only flag — blocks nothing.
  """
  @spec sensitive?(String.t()) :: boolean()
  def sensitive?(filename) when is_binary(filename) do
    filename
    |> Path.basename()
    |> String.downcase()
    |> Kernel.in(@sensitive_files)
  end

  @doc """
  File-type category by lowercased extname, in priority order:
  config > image > archive > text > binary.
  """
  @spec file_type(String.t()) :: String.t()
  def file_type(filename) when is_binary(filename) do
    e = ext(filename)

    cond do
      e in @config_exts -> "config"
      e in @image_exts -> "image"
      e in @archive_exts -> "archive"
      e in @text_exts -> "text"
      true -> "binary"
    end
  end

  defp ext(filename), do: filename |> Path.extname() |> String.downcase()
end
