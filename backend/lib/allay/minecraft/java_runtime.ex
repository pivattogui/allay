defmodule Allay.Minecraft.JavaRuntime do
  @moduledoc """
  Detects installed Java runtimes and picks one for a required major.
  `java -version` writes its banner to STDERR and exits 0 — probing
  must capture stderr or every runtime is silently missed.
  """

  @default_scan_dirs ["/opt/java", "/usr/lib/jvm"]

  def default_scan_dirs, do: @default_scan_dirs

  def parse_java_major(output) when is_binary(output) do
    case Regex.run(~r/version "([^"]+)"/, output) do
      [_, version] ->
        case version do
          "1." <> _ -> version |> String.split(".") |> Enum.at(1) |> parse_int()
          _ -> parse_int(version)
        end

      _ ->
        nil
    end
  end

  @doc """
  Returns `%{major => java_bin_path}`. First occurrence per major wins
  (scan order = given dir order, entries sorted for determinism).
  """
  def discover(scan_dirs \\ @default_scan_dirs) do
    for dir <- scan_dirs,
        {:ok, entries} <- [File.ls(dir)],
        entry <- Enum.sort(entries),
        java = Path.join([dir, entry, "bin", "java"]),
        major = probe(java),
        is_integer(major),
        reduce: %{} do
      acc -> Map.put_new(acc, major, java)
    end
  end

  def find_compatible(runtimes, required) when is_map(runtimes) and is_integer(required) do
    case Map.fetch(runtimes, required) do
      {:ok, path} ->
        {required, path}

      :error ->
        runtimes
        |> Map.keys()
        |> Enum.filter(&(&1 > required))
        |> Enum.sort()
        |> case do
          [] -> nil
          [major | _] -> {major, runtimes[major]}
        end
    end
  end

  defp probe(java_bin) do
    with true <- File.exists?(java_bin),
         {output, 0} <- System.cmd(java_bin, ["-version"], stderr_to_stdout: true) do
      parse_java_major(output)
    else
      _ -> nil
    end
  rescue
    # System.cmd raises for non-executable files
    ErlangError -> nil
  end

  defp parse_int(string) do
    case Integer.parse(string) do
      {int, _rest} -> int
      :error -> nil
    end
  end
end
