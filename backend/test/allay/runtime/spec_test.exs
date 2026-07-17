defmodule Allay.Runtime.SpecTest do
  use ExUnit.Case, async: true

  alias Allay.Runtime.Spec

  test "uses resource-efficient polling defaults" do
    spec = %Spec{
      server_id: "server-id",
      directory: "/tmp/server",
      java_bin: "java",
      ram_min_mb: 1024,
      ram_max_mb: 2048,
      rcon_port: 25_575,
      rcon_password: "secret"
    }

    assert spec.log_poll_ms == 500
    assert spec.metrics_interval_ms == 10_000
  end
end
