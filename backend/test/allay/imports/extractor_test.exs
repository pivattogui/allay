defmodule Allay.Imports.ExtractorTest do
  use ExUnit.Case, async: true

  alias Allay.Imports.Extractor

  @categories %{
    world: ["world/", "world_nether/"],
    configs: ["server.properties", "bukkit.yml"],
    plugins: ["plugins/AuthMe.jar", "plugins/AuthMe/config.yml"],
    jars: ["paper-1.21.4.jar"],
    logs: ["logs/latest.log"],
    other: ["whitelist.json", "ops.json"]
  }

  @entries [
    "world/level.dat",
    "world/region/r.0.0.mca",
    "world_nether/DIM-1/region/r.0.0.mca",
    "server.properties",
    "bukkit.yml",
    "plugins/AuthMe.jar",
    "plugins/AuthMe/config.yml",
    "paper-1.21.4.jar",
    "logs/latest.log",
    "whitelist.json",
    "ops.json"
  ]

  describe "resolve_selection/2 — presets" do
    test "world-only resolves to world prefixes only" do
      matchers = Extractor.resolve_selection(@categories, %{"preset" => "world-only"})
      assert "world/" in matchers
      assert "world_nether/" in matchers
      refute "server.properties" in matchers
    end

    test "world-configs adds the config paths" do
      matchers = Extractor.resolve_selection(@categories, %{"preset" => "world-configs"})
      assert "world/" in matchers
      assert "server.properties" in matchers
      assert "bukkit.yml" in matchers
      refute "paper-1.21.4.jar" in matchers
    end

    test "all-except-jars excludes jars and logs" do
      matchers = Extractor.resolve_selection(@categories, %{"preset" => "all-except-jars"})
      assert "world/" in matchers
      assert "server.properties" in matchers
      assert "plugins/AuthMe.jar" in matchers
      assert "whitelist.json" in matchers
      refute "paper-1.21.4.jar" in matchers
      refute "logs/latest.log" in matchers
    end
  end

  describe "select_paths/3 — preset/include/exclude against real entries" do
    test "world-only preset selects every world file" do
      paths = Extractor.select_paths(@categories, %{"preset" => "world-only"}, @entries)
      assert "world/level.dat" in paths
      assert "world_nether/DIM-1/region/r.0.0.mca" in paths
      refute "server.properties" in paths
      refute "plugins/AuthMe.jar" in paths
    end

    test "world-configs preset selects world files and config files" do
      paths = Extractor.select_paths(@categories, %{"preset" => "world-configs"}, @entries)
      assert "world/level.dat" in paths
      assert "server.properties" in paths
      assert "bukkit.yml" in paths
      refute "plugins/AuthMe.jar" in paths
      refute "paper-1.21.4.jar" in paths
    end

    test "all-except-jars selects everything but jars and logs" do
      paths = Extractor.select_paths(@categories, %{"preset" => "all-except-jars"}, @entries)
      assert "world/level.dat" in paths
      assert "server.properties" in paths
      assert "plugins/AuthMe.jar" in paths
      assert "whitelist.json" in paths
      refute "paper-1.21.4.jar" in paths
      refute "logs/latest.log" in paths
    end

    test "manual include list (prefix and exact)" do
      selection = %{"preset" => nil, "include" => ["world/", "whitelist.json"], "exclude" => []}
      paths = Extractor.select_paths(@categories, selection, @entries)
      assert "world/level.dat" in paths
      assert "whitelist.json" in paths
      refute "server.properties" in paths
    end

    test "exclude applies on top of a preset" do
      selection = %{"preset" => "world-only", "exclude" => ["world_nether/"]}
      paths = Extractor.select_paths(@categories, selection, @entries)
      assert "world/level.dat" in paths
      refute "world_nether/DIM-1/region/r.0.0.mca" in paths
    end
  end

  describe "extract_selection/4 — tar.gz" do
    test "extracts only the selected paths into the server dir" do
      {archive, _scratch} =
        tar_archive(%{
          "world/level.dat" => "lvl",
          "world/region/r.0.0.mca" => "reg",
          "server.properties" => "props",
          "paper.jar" => "jar"
        })

      server_dir = server_dir()
      selected = ["world/level.dat", "world/region/r.0.0.mca", "server.properties"]

      assert {:ok, imported} =
               Extractor.extract_selection(archive, selected, selected, server_dir)

      assert File.read!(Path.join(server_dir, "world/level.dat")) == "lvl"
      assert File.read!(Path.join(server_dir, "server.properties")) == "props"
      refute File.exists?(Path.join(server_dir, "paper.jar"))
      assert "server.properties" in imported
    end

    test "world-wraps a bare level.dat archive under world/" do
      {archive, _scratch} =
        tar_archive(%{"level.dat" => "lvl", "region/r.0.0.mca" => "reg"})

      server_dir = server_dir()
      original = ["level.dat", "region/", "region/r.0.0.mca"]
      selected = ["level.dat", "region/r.0.0.mca"]

      assert {:ok, imported} =
               Extractor.extract_selection(archive, original, selected, server_dir)

      assert File.read!(Path.join(server_dir, "world/level.dat")) == "lvl"
      assert File.read!(Path.join(server_dir, "world/region/r.0.0.mca")) == "reg"
      assert "world/level.dat" in imported
    end
  end

  describe "extract_selection/4 — zip" do
    test "extracts selected paths, stripping nothing for flat archives" do
      archive = zip_archive(%{"world/level.dat" => "lvl", "server.properties" => "props"})
      server_dir = server_dir()
      selected = ["world/level.dat", "server.properties"]

      assert {:ok, _} = Extractor.extract_selection(archive, selected, selected, server_dir)
      assert File.read!(Path.join(server_dir, "world/level.dat")) == "lvl"
      assert File.read!(Path.join(server_dir, "server.properties")) == "props"
    end

    test "world-wraps a bare level.dat zip under world/" do
      archive = zip_archive(%{"level.dat" => "lvl", "region/r.0.0.mca" => "reg"})
      server_dir = server_dir()
      original = ["level.dat", "region/r.0.0.mca"]
      selected = ["level.dat", "region/r.0.0.mca"]

      assert {:ok, _} = Extractor.extract_selection(archive, original, selected, server_dir)
      assert File.read!(Path.join(server_dir, "world/level.dat")) == "lvl"
      assert File.read!(Path.join(server_dir, "world/region/r.0.0.mca")) == "reg"
    end
  end

  describe "extract_selection/4 — empty selection" do
    test "returns {:ok, []} without touching the disk" do
      archive = zip_archive(%{"world/level.dat" => "lvl"})
      server_dir = server_dir()
      assert {:ok, []} = Extractor.extract_selection(archive, ["world/level.dat"], [], server_dir)
    end
  end

  describe "extract_selection/4 — traversal containment" do
    test "refuses a selected entry whose raw name escapes the sandbox" do
      archive = zip_archive(%{"world/level.dat" => "lvl"})
      server_dir = server_dir()
      evil = "../../../../tmp/allay_escape_#{System.unique_integer([:positive])}"

      assert {:error, :invalid_path} =
               Extractor.extract_selection(archive, [evil], [evil], server_dir)

      refute File.exists?(Path.expand(evil, server_dir))
    end

    test "refuses an absolute selected entry" do
      archive = zip_archive(%{"world/level.dat" => "lvl"})
      server_dir = server_dir()

      assert {:error, :invalid_path} =
               Extractor.extract_selection(archive, ["/etc/x"], ["/etc/x"], server_dir)
    end
  end

  describe "extract_selection/5 — real archives with a shared root and dir entries" do
    # Built from a real on-disk tree so the archive carries directory entries
    # (trailing slash) and a shared root — exactly what trips a naive extractor.

    test "rooted world: root re-prepended for reads, content lands under world/" do
      archive = rooted_tar("world", %{"level.dat" => "lvl", "region/r.mca" => "reg"})
      server_dir = server_dir()
      # analyzer would strip "world" → normalized selection + root "world"
      selected = ["level.dat", "region/", "region/r.mca"]

      assert {:ok, _} =
               Extractor.extract_selection(archive, selected, selected, server_dir, "world")

      assert File.read!(Path.join(server_dir, "world/level.dat")) == "lvl"
      assert File.read!(Path.join(server_dir, "world/region/r.mca")) == "reg"
    end

    test "wrapper folder: stripped root reconstructs reads, content lands at server root" do
      archive =
        rooted_tar("backup", %{"world/level.dat" => "lvl", "server.properties" => "props"})

      server_dir = server_dir()
      selected = ["world/", "world/level.dat", "server.properties"]

      assert {:ok, _} =
               Extractor.extract_selection(archive, selected, selected, server_dir, "backup")

      assert File.read!(Path.join(server_dir, "world/level.dat")) == "lvl"
      assert File.read!(Path.join(server_dir, "server.properties")) == "props"
    end

    test "directory entries with a trailing slash are not rejected as traversal" do
      archive = rooted_tar("world", %{"region/r.mca" => "reg"})
      server_dir = server_dir()
      # "region/" is a directory entry — the old `path == sanitize(path)` check
      # wrongly rejected it as :invalid_path. No level.dat here, so no world
      # wrap; the point is the dir entry is accepted and its file extracted.
      selected = ["region/", "region/r.mca"]

      assert {:ok, _} =
               Extractor.extract_selection(archive, selected, selected, server_dir, "world")

      assert File.read!(Path.join(server_dir, "region/r.mca")) == "reg"
    end
  end

  # ── helpers ──────────────────────────────────────────────────────────────

  # Builds a real .tar.gz from an on-disk tree rooted at `root/`, so the archive
  # contains directory entries and a shared root component.
  defp rooted_tar(root, files) do
    scratch = Path.join(System.tmp_dir!(), "rooted_#{System.unique_integer([:positive])}")
    root_dir = Path.join(scratch, root)

    Enum.each(files, fn {name, content} ->
      dest = Path.join(root_dir, name)
      File.mkdir_p!(Path.dirname(dest))
      File.write!(dest, content)
    end)

    path = Path.join(System.tmp_dir!(), "rt_#{System.unique_integer([:positive])}.tar.gz")

    :ok =
      :erl_tar.create(to_charlist(path), [{to_charlist(root), to_charlist(root_dir)}], [
        :compressed
      ])

    on_exit(fn ->
      File.rm_rf(scratch)
      File.rm(path)
    end)

    path
  end

  defp server_dir do
    dir = Path.join(System.tmp_dir!(), "extract_dest_#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf(dir) end)
    dir
  end

  defp zip_archive(files) do
    path = Path.join(System.tmp_dir!(), "ex_#{System.unique_integer([:positive])}.zip")
    on_exit(fn -> File.rm(path) end)
    entries = Enum.map(files, fn {name, content} -> {to_charlist(name), content} end)
    {:ok, _} = :zip.create(to_charlist(path), entries)
    path
  end

  defp tar_archive(files) do
    scratch = Path.join(System.tmp_dir!(), "extar_#{System.unique_integer([:positive])}")
    File.mkdir_p!(scratch)
    path = Path.join(System.tmp_dir!(), "ex_#{System.unique_integer([:positive])}.tar.gz")

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
    {path, scratch}
  end
end
