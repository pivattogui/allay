defmodule Allay.Servers.ServerTest do
  use Allay.DataCase, async: false

  alias Allay.Servers.Server

  @valid_attrs %{
    name: "My Server",
    type: "vanilla",
    version: "1.21.4",
    port: 25_565,
    ram_min_mb: 1024,
    ram_max_mb: 2048,
    directory: "/data/servers/my-server",
    rcon_port: 35_565,
    rcon_password: "secret123"
  }

  defp build(overrides), do: Map.merge(@valid_attrs, overrides)

  # ── create_changeset ─────────────────────────────────────────────────────────

  describe "create_changeset/2 — valid" do
    test "accepts full valid attrs" do
      cs = Server.create_changeset(%Server{}, @valid_attrs)
      assert cs.valid?
    end

    test "applies defaults: ram_min_mb=1024, ram_max_mb=2048, auto_start=false, auto_restart=false" do
      attrs = Map.drop(@valid_attrs, [:ram_min_mb, :ram_max_mb])
      cs = Server.create_changeset(%Server{}, attrs)
      assert cs.valid?
      assert get_field(cs, :ram_min_mb) == 1024
      assert get_field(cs, :ram_max_mb) == 2048
      assert get_field(cs, :auto_start) == false
      assert get_field(cs, :auto_restart) == false
    end
  end

  describe "create_changeset/2 — name" do
    test "required" do
      cs = Server.create_changeset(%Server{}, build(%{name: nil}))
      assert %{name: ["can't be blank"]} = errors_on(cs)
    end

    test "min length 1" do
      cs = Server.create_changeset(%Server{}, build(%{name: ""}))
      assert %{name: [_ | _]} = errors_on(cs)
    end

    test "max length 50" do
      cs = Server.create_changeset(%Server{}, build(%{name: String.duplicate("a", 51)}))
      assert %{name: [_ | _]} = errors_on(cs)
    end

    test "exactly 50 chars is valid" do
      cs = Server.create_changeset(%Server{}, build(%{name: String.duplicate("a", 50)}))
      assert cs.valid?
    end
  end

  describe "create_changeset/2 — type" do
    test "required" do
      cs = Server.create_changeset(%Server{}, build(%{type: nil}))
      assert %{type: [_ | _]} = errors_on(cs)
    end

    test "vanilla accepted" do
      cs = Server.create_changeset(%Server{}, build(%{type: "vanilla"}))
      assert cs.valid?
    end

    test "paper accepted" do
      cs = Server.create_changeset(%Server{}, build(%{type: "paper"}))
      assert cs.valid?
    end

    test "invalid type rejected" do
      cs = Server.create_changeset(%Server{}, build(%{type: "forge"}))
      assert %{type: [_ | _]} = errors_on(cs)
    end
  end

  describe "create_changeset/2 — version" do
    test "required" do
      cs = Server.create_changeset(%Server{}, build(%{version: nil}))
      assert %{version: [_ | _]} = errors_on(cs)
    end

    test "min length 1" do
      cs = Server.create_changeset(%Server{}, build(%{version: ""}))
      assert %{version: [_ | _]} = errors_on(cs)
    end
  end

  describe "create_changeset/2 — port" do
    test "required" do
      cs = Server.create_changeset(%Server{}, build(%{port: nil}))
      assert %{port: [_ | _]} = errors_on(cs)
    end

    test "below configured range" do
      cs = Server.create_changeset(%Server{}, build(%{port: 25_564}))
      assert %{port: ["out of configured range"]} = errors_on(cs)
    end

    test "above configured range" do
      cs = Server.create_changeset(%Server{}, build(%{port: 25_576}))
      assert %{port: ["out of configured range"]} = errors_on(cs)
    end

    test "at lower bound of range" do
      cs = Server.create_changeset(%Server{}, build(%{port: 25_565}))
      assert cs.valid?
    end

    test "at upper bound of range" do
      cs = Server.create_changeset(%Server{}, build(%{port: 25_575}))
      assert cs.valid?
    end

    test "inside range" do
      cs = Server.create_changeset(%Server{}, build(%{port: 25_570}))
      assert cs.valid?
    end
  end

  describe "create_changeset/2 — ram" do
    test "ram_min_mb below 512 rejected" do
      cs = Server.create_changeset(%Server{}, build(%{ram_min_mb: 511}))
      assert %{ram_min_mb: [_ | _]} = errors_on(cs)
    end

    test "ram_min_mb above 32768 rejected" do
      cs = Server.create_changeset(%Server{}, build(%{ram_min_mb: 32_769}))
      assert %{ram_min_mb: [_ | _]} = errors_on(cs)
    end

    test "ram_max_mb below 512 rejected" do
      cs = Server.create_changeset(%Server{}, build(%{ram_max_mb: 511}))
      assert %{ram_max_mb: [_ | _]} = errors_on(cs)
    end

    test "ram_max_mb above 32768 rejected" do
      cs = Server.create_changeset(%Server{}, build(%{ram_max_mb: 32_769}))
      assert %{ram_max_mb: [_ | _]} = errors_on(cs)
    end

    test "ram_min_mb > ram_max_mb adds error to ram_max_mb" do
      cs = Server.create_changeset(%Server{}, build(%{ram_min_mb: 2048, ram_max_mb: 1024}))
      assert %{ram_max_mb: [_ | _]} = errors_on(cs)
    end

    test "ram_min_mb == ram_max_mb is valid" do
      cs = Server.create_changeset(%Server{}, build(%{ram_min_mb: 1024, ram_max_mb: 1024}))
      assert cs.valid?
    end

    test "ram_min_mb < ram_max_mb is valid" do
      cs = Server.create_changeset(%Server{}, build(%{ram_min_mb: 512, ram_max_mb: 1024}))
      assert cs.valid?
    end
  end

  # ── update_changeset ──────────────────────────────────────────────────────────

  describe "update_changeset/2" do
    test "accepts partial updates" do
      cs = Server.update_changeset(%Server{}, %{name: "Renamed"})
      assert cs.valid?
    end

    test "name max 50" do
      cs = Server.update_changeset(%Server{}, %{name: String.duplicate("b", 51)})
      assert %{name: [_ | _]} = errors_on(cs)
    end

    test "port must be in configured range" do
      cs = Server.update_changeset(%Server{}, %{port: 25_564})
      assert %{port: [_ | _]} = errors_on(cs)
    end

    test "port inside range accepted" do
      cs = Server.update_changeset(%Server{}, %{port: 25_570})
      assert cs.valid?
    end

    test "NO ram cross-check on update_changeset (legacy parity)" do
      # update_changeset does not validate ram_min <= ram_max
      cs = Server.update_changeset(%Server{}, %{ram_min_mb: 2048, ram_max_mb: 1024})
      refute Map.has_key?(errors_on(cs), :ram_max_mb)
    end
  end

  # ── config_changeset ──────────────────────────────────────────────────────────

  describe "config_changeset/2" do
    test "accepts valid config attrs" do
      cs =
        Server.config_changeset(%Server{ram_min_mb: 1024, ram_max_mb: 2048}, %{
          name: "Updated",
          jvm_args: "-XX:+UseG1GC",
          restart_limit: 5
        })

      assert cs.valid?
    end

    test "restart_limit 0 accepted" do
      cs =
        Server.config_changeset(%Server{ram_min_mb: 1024, ram_max_mb: 2048}, %{restart_limit: 0})

      assert cs.valid?
    end

    test "restart_limit 10 accepted" do
      cs =
        Server.config_changeset(%Server{ram_min_mb: 1024, ram_max_mb: 2048}, %{restart_limit: 10})

      assert cs.valid?
    end

    test "restart_limit above 10 rejected" do
      cs =
        Server.config_changeset(%Server{ram_min_mb: 1024, ram_max_mb: 2048}, %{restart_limit: 11})

      assert %{restart_limit: [_ | _]} = errors_on(cs)
    end

    test "restart_limit below 0 rejected" do
      cs =
        Server.config_changeset(%Server{ram_min_mb: 1024, ram_max_mb: 2048}, %{restart_limit: -1})

      assert %{restart_limit: [_ | _]} = errors_on(cs)
    end

    test "ram cross-check: input min > input max adds error to ram_max_mb" do
      cs =
        Server.config_changeset(%Server{ram_min_mb: 1024, ram_max_mb: 2048}, %{
          ram_min_mb: 4096,
          ram_max_mb: 1024
        })

      assert %{ram_max_mb: [_ | _]} = errors_on(cs)
    end

    test "ram cross-check: new min > existing max adds error to ram_max_mb" do
      # existing max is 2048, new min 4096 — no new max provided
      cs =
        Server.config_changeset(%Server{ram_min_mb: 1024, ram_max_mb: 2048}, %{ram_min_mb: 4096})

      assert %{ram_max_mb: [_ | _]} = errors_on(cs)
    end

    test "ram cross-check: new max < existing min adds error to ram_max_mb" do
      # existing min is 1024, new max 512 — no new min provided
      cs =
        Server.config_changeset(%Server{ram_min_mb: 1024, ram_max_mb: 2048}, %{ram_max_mb: 512})

      assert %{ram_max_mb: [_ | _]} = errors_on(cs)
    end

    test "ram cross-check: both valid values pass" do
      cs =
        Server.config_changeset(%Server{ram_min_mb: 1024, ram_max_mb: 2048}, %{
          ram_min_mb: 2048,
          ram_max_mb: 4096
        })

      assert cs.valid?
    end
  end
end
