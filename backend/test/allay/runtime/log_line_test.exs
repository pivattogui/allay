defmodule Allay.Runtime.LogLineTest do
  use ExUnit.Case, async: true

  alias Allay.Runtime.LogLine

  @now ~U[2026-06-11 12:00:00Z]

  test "parses the Paper header form" do
    assert %{level: :info, message: "Done (3.2s)! For help, type \"help\"", timestamp: @now} =
             LogLine.parse(~s|[12:34:56 INFO]: Done (3.2s)! For help, type "help"|, @now)
  end

  test "parses the vanilla thread header form" do
    assert %{level: :warn, message: "Can't keep up!"} =
             LogLine.parse("[12:34:56] [Server thread/WARN]: Can't keep up!", @now)
  end

  test "level defaults to info and message passes through for unheadered lines" do
    assert %{level: :info, message: "raw garbage"} = LogLine.parse("raw garbage", @now)
  end

  test "error level is detected case-insensitively" do
    assert %{level: :error} = LogLine.parse("[12:34:56 error]: boom", @now)
  end

  test "render/1 emits the wire map with ISO timestamp" do
    line = LogLine.parse("[12:34:56 INFO]: hello", @now)

    assert LogLine.render(line) == %{
             timestamp: "2026-06-11T12:00:00Z",
             level: "info",
             message: "hello"
           }
  end
end
