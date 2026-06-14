defmodule AllayWeb.ServerParams do
  @moduledoc """
  Translates the camelCase request bodies the React client sends into the
  snake_case attribute keys the `Allay.Servers` changesets cast. Only known
  server attributes are mapped; unknown keys are dropped so the changesets
  never see client-controlled extras.
  """

  @field_map %{
    "name" => :name,
    "type" => :type,
    "version" => :version,
    "port" => :port,
    "ramMinMb" => :ram_min_mb,
    "ramMaxMb" => :ram_max_mb,
    "autoStart" => :auto_start,
    "autoRestart" => :auto_restart,
    "jvmArgs" => :jvm_args,
    "javaPath" => :java_path,
    "restartLimit" => :restart_limit,
    "restartSchedule" => :restart_schedule
  }

  @doc "Maps a camelCase string-keyed params map to snake_case atom-keyed attrs."
  def to_attrs(params) when is_map(params) do
    Enum.reduce(@field_map, %{}, fn {wire_key, attr_key}, acc ->
      case Map.fetch(params, wire_key) do
        {:ok, value} -> Map.put(acc, attr_key, value)
        :error -> acc
      end
    end)
  end
end
