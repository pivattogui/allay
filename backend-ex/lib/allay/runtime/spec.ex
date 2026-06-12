defmodule Allay.Runtime.Spec do
  @moduledoc """
  Everything the runtime needs to run one server, resolved upfront by
  the caller (context layer): java binary already chosen, RCON
  credentials already provisioned. The runtime never touches the DB.
  """

  @enforce_keys [
    :server_id,
    :directory,
    :java_bin,
    :ram_min_mb,
    :ram_max_mb,
    :rcon_port,
    :rcon_password
  ]
  defstruct @enforce_keys ++
              [
                jvm_args: "",
                rcon_host: "127.0.0.1",
                auto_restart: %{enabled?: false, limit: 3, window_ms: 600_000},
                startup_timeout_ms: 120_000,
                stop_timeout_ms: 30_000,
                term_timeout_ms: 5_000,
                respawn_delay_ms: 2_000,
                rcon_mod: Allay.Minecraft.Rcon,
                rcon_probe_ms: 1_000,
                log_poll_ms: 200,
                metrics_interval_ms: 5_000
              ]

  @type t :: %__MODULE__{}

  def java_args(%__MODULE__{} = spec) do
    custom = spec.jvm_args |> String.split(~r/\s+/, trim: true)

    ["-Xms#{spec.ram_min_mb}M", "-Xmx#{spec.ram_max_mb}M"] ++
      custom ++ ["-jar", "server.jar", "nogui"]
  end
end
