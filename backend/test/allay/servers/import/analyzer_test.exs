defmodule Allay.Servers.Import.AnalyzerTest do
  use ExUnit.Case, async: true

  alias Allay.Servers.Import.Analyzer

  # Builds a real .zip from a {name => content} map at a fresh temp path.
  defp zip_archive(files) do
    path = Path.join(System.tmp_dir!(), "an_#{System.unique_integer([:positive])}.zip")
    on_exit(fn -> File.rm(path) end)

    entries = Enum.map(files, fn {name, content} -> {to_charlist(name), content} end)
    {:ok, _} = :zip.create(to_charlist(path), entries)
    path
  end

  # Builds a real .tar.gz from a {name => content} map. erl_tar.create needs
  # real source files on disk, so they're staged in a scratch dir first.
  defp tar_archive(files) do
    scratch = Path.join(System.tmp_dir!(), "tar_#{System.unique_integer([:positive])}")
    File.mkdir_p!(scratch)
    path = Path.join(System.tmp_dir!(), "an_#{System.unique_integer([:positive])}.tar.gz")

    on_exit(fn ->
      File.rm_rf(scratch)
      File.rm(path)
    end)

    members =
      Enum.map(files, fn {name, content} ->
        src = Path.join(scratch, name)
        File.mkdir_p!(Path.dirname(src))
        File.write!(src, content)
        {to_charlist(name), to_charlist(src)}
      end)

    :ok = :erl_tar.create(to_charlist(path), members, [:compressed])
    path
  end

  describe "list_entries/1 — directory normalization" do
    test "zip directory entries keep the trailing slash convention" do
      # OS-built zips carry explicit dir entries; erl_tar/:zip created archives
      # do not, so this exercises the trailing-slash normalization path directly.
      path = zip_archive(%{"world/level.dat" => "d", "server.properties" => "p"})
      assert {:ok, entries} = Analyzer.list_entries(path)
      assert "world/level.dat" in entries
      assert "server.properties" in entries
    end

    test "tar directory entries are normalized to a trailing slash" do
      # erl_tar.create stores an explicit :directory record for a directory
      # member (verbose table reports type :directory); list_entries appends the
      # trailing slash. A plain file member stays as-is.
      scratch = Path.join(System.tmp_dir!(), "tcard_#{System.unique_integer([:positive])}")
      File.mkdir_p!(Path.join(scratch, "region"))
      File.write!(Path.join(scratch, "level.dat"), "d")
      path = Path.join(System.tmp_dir!(), "td_#{System.unique_integer([:positive])}.tar.gz")
      on_exit(fn -> File.rm_rf(scratch) end)
      on_exit(fn -> File.rm(path) end)

      :ok =
        :erl_tar.create(
          to_charlist(path),
          [
            {~c"region", to_charlist(Path.join(scratch, "region"))},
            {~c"level.dat", to_charlist(Path.join(scratch, "level.dat"))}
          ],
          [:compressed]
        )

      assert {:ok, entries} = Analyzer.list_entries(path)
      assert "region/" in entries
      assert "level.dat" in entries
    end

    test "tar non-regular entries (symlinks) are dropped at list time" do
      # Built via the OS tar so the archive actually carries a symlink member;
      # erl_tar.create cannot emit one from a plain file list.
      scratch = Path.join(System.tmp_dir!(), "slsrc_#{System.unique_integer([:positive])}")
      File.mkdir_p!(scratch)
      File.write!(Path.join(scratch, "real.txt"), "real")
      File.ln_s!("real.txt", Path.join(scratch, "link.txt"))
      path = Path.join(System.tmp_dir!(), "sl_#{System.unique_integer([:positive])}.tar.gz")
      on_exit(fn -> File.rm_rf(scratch) end)
      on_exit(fn -> File.rm(path) end)

      {_out, 0} =
        System.cmd("tar", ["-czf", path, "-C", scratch, "real.txt", "link.txt"],
          stderr_to_stdout: true
        )

      assert {:ok, entries} = Analyzer.list_entries(path)
      assert "real.txt" in entries
      refute "link.txt" in entries
    end

    test "normalize/1 drops __MACOSX artifacts" do
      raw = ["__MACOSX/._world", "world/level.dat", "server.properties"]
      entries = Analyzer.normalize(raw)
      refute Enum.any?(entries, &String.starts_with?(&1, "__MACOSX"))
      assert "world/level.dat" in entries
      assert "server.properties" in entries
    end

    test "normalize/1 strips a single shared root component" do
      raw = ["server-backup/world/level.dat", "server-backup/server.properties"]
      entries = Analyzer.normalize(raw)
      assert "world/level.dat" in entries
      assert "server.properties" in entries
    end
  end

  describe "categorize/1 — legacy parity table" do
    test "categorizes world prefixes (dedup'd, not files)" do
      result =
        Analyzer.categorize([
          "world/level.dat",
          "world/region/r.0.0.mca",
          "world_nether/DIM-1/region/r.0.0.mca"
        ])

      assert "world/" in result.world
      assert "world_nether/" in result.world
    end

    test "uses world/ prefix only once when a wrapper directory is present" do
      assert %{world: ["world/"]} =
               Analyzer.categorize(["world/level.dat", "world/region/r.0.0.mca"])
    end

    test "categorizes exact config patterns in order" do
      assert %{configs: ["server.properties", "bukkit.yml", "spigot.yml"]} =
               Analyzer.categorize(["server.properties", "bukkit.yml", "spigot.yml"])
    end

    test "categorizes plugins" do
      result = Analyzer.categorize(["plugins/AuthMe.jar", "plugins/AuthMe/config.yml"])
      assert "plugins/AuthMe.jar" in result.plugins
      assert "plugins/AuthMe/config.yml" in result.plugins
    end

    test "categorizes only root-level jars" do
      assert %{jars: ["paper-1.21.4.jar"]} =
               Analyzer.categorize(["paper-1.21.4.jar", "world/level.dat"])
    end

    test "categorizes logs and crash-reports" do
      result = Analyzer.categorize(["logs/latest.log", "crash-reports/crash-2024.txt"])
      assert "logs/latest.log" in result.logs
      assert "crash-reports/crash-2024.txt" in result.logs
    end

    test "puts whitelist/ops/banned in other" do
      assert %{other: ["whitelist.json", "ops.json", "banned-players.json"]} =
               Analyzer.categorize(["whitelist.json", "ops.json", "banned-players.json"])
    end

    test "categorizes config/ subdir entries with config extensions" do
      result = Analyzer.categorize(["config/paper-global.yml", "config/foo.toml"])
      assert "config/paper-global.yml" in result.configs
      assert "config/foo.toml" in result.configs
    end

    test "drops non-root unrecognized entries" do
      result = Analyzer.categorize(["deep/nested/file.bin"])
      assert result == %{world: [], configs: [], plugins: [], jars: [], logs: [], other: []}
    end

    test "bare-world layout returns real prefixes and keeps other entries clean" do
      entries = [
        "level.dat",
        "level.dat_old",
        "session.lock",
        "icon.png",
        "region/r.0.0.mca",
        "entities/r.0.0.mca",
        "data/raids.dat",
        "playerdata/abc.dat",
        "DIM-1/region/r.0.0.mca",
        "DIM1/region/r.0.0.mca",
        "spsSettings.json"
      ]

      result = Analyzer.categorize(entries)

      refute "world/" in result.world

      for prefix <- [
            "level.dat",
            "level.dat_old",
            "session.lock",
            "icon.png",
            "region/",
            "entities/",
            "data/",
            "playerdata/",
            "DIM-1/",
            "DIM1/"
          ] do
        assert prefix in result.world, "expected #{prefix} claimed by bare world"
      end

      assert result.other == ["spsSettings.json"]
    end
  end

  describe "classify/1" do
    test "world-only when level.dat present without server.properties" do
      categories = %{world: ["world/"], configs: [], plugins: [], jars: [], logs: [], other: []}
      assert "world-only" = Analyzer.classify({categories, ["world/level.dat"]})
    end

    test "full-backup when server.properties and level.dat present" do
      categories = %{
        world: ["world/"],
        configs: ["server.properties"],
        plugins: [],
        jars: ["server.jar"],
        logs: [],
        other: []
      }

      assert "full-backup" =
               Analyzer.classify({categories, ["server.properties", "world/level.dat"]})
    end

    test "mixed when no level.dat / world dir found" do
      categories = %{
        world: [],
        configs: ["server.properties"],
        plugins: ["plugins/Essentials.jar"],
        jars: [],
        logs: [],
        other: []
      }

      assert "mixed" =
               Analyzer.classify({categories, ["server.properties", "plugins/Essentials.jar"]})
    end
  end

  describe "analyze/1 — end to end on a real archive" do
    test "zip: full backup classification, categories, preset, and total size" do
      path =
        zip_archive(%{
          "world/level.dat" => "d",
          "world/region/r.0.0.mca" => "r",
          "server.properties" => "props",
          "plugins/AuthMe.jar" => "jar",
          "paper.jar" => "p",
          "logs/latest.log" => "log",
          "whitelist.json" => "[]"
        })

      assert {:ok, result} = Analyzer.analyze(path)
      assert result.detected_type == "full-backup"
      assert result.suggested_preset == "world-configs"
      assert "world/" in result.categories.world
      assert "server.properties" in result.categories.configs
      assert "plugins/AuthMe.jar" in result.categories.plugins
      assert "paper.jar" in result.categories.jars
      assert "logs/latest.log" in result.categories.logs
      assert "whitelist.json" in result.categories.other
      assert result.total_size == File.stat!(path).size
    end

    test "tar.gz: world-only classification and preset" do
      path = tar_archive(%{"world/level.dat" => "d", "world/region/r.0.0.mca" => "r"})

      assert {:ok, result} = Analyzer.analyze(path)
      assert result.detected_type == "world-only"
      assert result.suggested_preset == "world-only"
    end

    test "mixed archive suggests no preset" do
      path = zip_archive(%{"server.properties" => "p", "plugins/Essentials.jar" => "j"})

      assert {:ok, result} = Analyzer.analyze(path)
      assert result.detected_type == "mixed"
      assert result.suggested_preset == nil
    end
  end
end
