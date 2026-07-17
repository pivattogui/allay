defmodule Allay.Minecraft.JavaRuntime do
  @moduledoc """
  Detects installed Java runtimes and picks one for a required major.
  `java -version` writes its banner to STDERR and exits 0 — probing
  must capture stderr or every runtime is silently missed.
  """

  @system_scan_dirs [
    "/opt/java",
    "/usr/lib/jvm",
    "/opt/homebrew/opt",
    "/usr/local/opt",
    "/Library/Java/JavaVirtualMachines"
  ]
  @probe_timeout_ms 2_000

  def default_scan_dirs do
    case System.user_home() do
      nil ->
        @system_scan_dirs

      home ->
        [
          Path.join(home, ".asdf/installs/java"),
          Path.join(home, ".sdkman/candidates/java")
          | @system_scan_dirs
        ]
    end
  end

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
  def discover(scan_dirs \\ default_scan_dirs()) do
    scan_dirs
    |> Enum.flat_map(&java_candidates/1)
    |> discover_executables()
  end

  @doc """
  Discovers Java from explicit roots, common installation managers, JAVA_HOME,
  and the executable available on PATH. Explicit roots have highest priority.
  """
  def discover_system(scan_dirs \\ []) do
    explicit_candidates =
      scan_dirs
      |> Enum.uniq()
      |> Enum.flat_map(&java_candidates/1)

    direct_candidates = [java_home_executable(), System.find_executable("java")]

    default_candidates =
      default_scan_dirs()
      |> Enum.reject(&(&1 in scan_dirs))
      |> Enum.flat_map(&java_candidates/1)

    discover_executables(explicit_candidates ++ direct_candidates ++ default_candidates)
  end

  @doc "Returns the executable's Java major, or nil when it cannot be executed or identified."
  def probe_major(java_bin, timeout_ms \\ @probe_timeout_ms)

  def probe_major(java_bin, timeout_ms) when is_binary(java_bin) and is_integer(timeout_ms) do
    probe(java_bin, timeout_ms)
  end

  def probe_major(_java_bin, _timeout_ms), do: nil

  defp discover_executables(java_executables) do
    for java <- java_executables,
        is_binary(java),
        major = probe(java, @probe_timeout_ms),
        is_integer(major),
        reduce: %{} do
      acc -> Map.put_new(acc, major, java)
    end
  end

  defp java_candidates(dir) do
    case File.ls(dir) do
      {:ok, entries} ->
        entries
        |> Enum.sort()
        |> Enum.flat_map(fn entry ->
          installation_dir = Path.join(dir, entry)

          [
            Path.join([installation_dir, "bin", "java"]),
            Path.join([installation_dir, "Contents", "Home", "bin", "java"])
          ]
        end)

      {:error, _reason} ->
        []
    end
  end

  defp java_home_executable do
    case System.get_env("JAVA_HOME") do
      nil -> nil
      java_home -> Path.join([java_home, "bin", "java"])
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

  defp probe(java_bin, timeout_ms) do
    if File.exists?(java_bin) do
      task =
        Task.async(fn ->
          try do
            System.cmd(java_bin, ["-version"], stderr_to_stdout: true)
          rescue
            ErlangError -> :probe_failed
          end
        end)

      case Task.yield(task, timeout_ms) || Task.shutdown(task, :brutal_kill) do
        {:ok, {output, 0}} -> parse_java_major(output)
        _other -> nil
      end
    end
  end

  defp parse_int(string) do
    case Integer.parse(string) do
      {int, _rest} -> int
      :error -> nil
    end
  end
end
