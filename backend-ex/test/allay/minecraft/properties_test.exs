defmodule Allay.Minecraft.PropertiesTest do
  use ExUnit.Case, async: true

  alias Allay.Minecraft.Properties

  describe "parse/1" do
    test "parses key=value lines, skipping comments and blanks" do
      raw = """
      #Minecraft server properties
      #Mon Jun 09 12:00:00 UTC 2026

      server-port=25565
      motd=A Minecraft Server
      level-seed=
      """

      assert Properties.parse(raw) == %{
               "server-port" => "25565",
               "motd" => "A Minecraft Server",
               "level-seed" => ""
             }
    end

    test "splits at the first = only and requires a non-empty key" do
      assert Properties.parse("motd=a=b=c\n=orphan") == %{"motd" => "a=b=c"}
    end

    test "empty input parses to an empty map" do
      assert Properties.parse("") == %{}
    end
  end

  describe "serialize/1" do
    test "emits k=v lines with a trailing newline" do
      assert Properties.serialize(%{"server-port" => "25565"}) == "server-port=25565\n"
    end

    test "round-trips with parse" do
      props = %{"a" => "1", "b" => "x=y", "c" => ""}
      assert props |> Properties.serialize() |> Properties.parse() == props
    end
  end

  describe "put_key/3" do
    test "replaces an existing key in place, preserving everything else" do
      raw = "#header\nserver-port=25565\nmotd=hello\n"

      assert Properties.put_key(raw, "server-port", "25600") ==
               "#header\nserver-port=25600\nmotd=hello\n"
    end

    test "appends the key when absent" do
      assert Properties.put_key("motd=hello\n", "enable-rcon", "true") ==
               "motd=hello\nenable-rcon=true\n"
    end

    test "appends to content without a trailing newline" do
      assert Properties.put_key("motd=hello", "rcon.port", "25575") ==
               "motd=hello\nrcon.port=25575\n"
    end
  end
end
