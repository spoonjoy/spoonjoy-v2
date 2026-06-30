#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "fileutils"
require "open3"
require "optparse"
require "set"
require "time"

options = {
  artifact_root: nil,
  manifest: nil
}

OptionParser.new do |parser|
  parser.banner = "Usage: ruby scripts/audit-web-validation-artifacts.rb --artifact-root PATH --manifest PATH"
  parser.on("--artifact-root PATH", "Task artifact root") { |value| options[:artifact_root] = value }
  parser.on("--manifest PATH", "Manifest output path") { |value| options[:manifest] = value }
end.parse!

abort "missing --artifact-root" unless options[:artifact_root]
abort "missing --manifest" unless options[:manifest]

artifact_root = File.expand_path(options[:artifact_root])
web_artifact_dir = File.join(artifact_root, "web")
manifest_path = File.expand_path(options[:manifest])

def artifact(path, unit:, kind:, description:, allow_empty: false, accepted_paths: nil, expected_capability: nil)
  {
    "path" => path,
    "acceptedPaths" => accepted_paths || [path],
    "unit" => unit,
    "kind" => kind,
    "description" => description,
    "allowEmpty" => allow_empty,
    "expectedCapability" => expected_capability
  }.compact
end

def log(path, unit:, kind:, description:, allow_empty: false, accepted_paths: nil)
  artifact("web/#{path}", unit: unit, kind: kind, description: description, allow_empty: allow_empty, accepted_paths: accepted_paths&.map { |accepted| "web/#{accepted}" })
end

def blocker(path, unit:, description:, expected_capability:)
  artifact("web/#{path}", unit: unit, kind: "blocker", description: description, expected_capability: expected_capability)
end

MATRIX_ENTRY_FILES = {
  "web-focused" => ["%<slug>s-vitest.log"],
  "web-route-coverage" => ["%<slug>s-route-coverage.log"],
  "web-docs-drift" => ["%<slug>s-docs-drift.log"],
  "web-playground-generate" => ["%<slug>s-api-playground-generate.log", "%<slug>s-api-playground-drift.log"],
  "web-typecheck" => ["%<slug>s-typecheck.log"],
  "web-build" => ["%<slug>s-build.log"],
  "web-coverage-full" => ["%<slug>s-coverage.log"],
  "web-warning-scan" => ["%<slug>s-warning-scan.log"]
}.freeze

def matrix_artifacts(unit:, slug:, entries:, aliases: {})
  entries.flat_map do |entry|
    MATRIX_ENTRY_FILES.fetch(entry).map do |template|
      file = format(template, slug: slug)
      accepted = aliases.fetch(file, nil)
      log(
        file,
        unit: unit,
        kind: "matrix:#{entry}",
        description: "#{unit} #{entry} artifact for #{slug}",
        allow_empty: file.end_with?("-api-playground-drift.log"),
        accepted_paths: accepted
      )
    end
  end
end

required_red_artifacts = [
  log("unit-1a-contract-red.log", unit: "1a", kind: "red", description: "REST v1 contract registry red tests"),
  log("unit-2a-me-red.log", unit: "2a", kind: "red", description: "native account/token API red tests"),
  log("unit-3a-users-search-red.log", unit: "3a", kind: "red", description: "user/search API red tests"),
  log("unit-4a-recipe-writes-red.log", unit: "4a", kind: "red", description: "recipe write API red tests"),
  log("unit-5a-recipe-steps-red.log", unit: "5a", kind: "red", description: "recipe step API red tests"),
  log("unit-6a-covers-red.log", unit: "6a", kind: "red", description: "recipe cover API red tests"),
  log("unit-7a-spoons-red.log", unit: "7a", kind: "red", description: "spoon cook-log API red tests"),
  log("unit-8a-cookbook-writes-red.log", unit: "8a", kind: "red", description: "cookbook write API red tests"),
  log("unit-9a-shopping-parity-red.log", unit: "9a", kind: "red", description: "shopping API parity red tests"),
  log("unit-10a-sync-red.log", unit: "10a", kind: "red", description: "native sync API red tests"),
  log("unit-10d-recipe-import-red.log", unit: "10d", kind: "red", description: "recipe import API red tests"),
  log("unit-20a-aasa-red.log", unit: "20a", kind: "red", description: "AASA route contract red tests"),
  log("unit-20a-route-manifest-red.log", unit: "20a", kind: "red", description: "web route manifest red tests"),
  log("unit-24a-docs-red.log", unit: "24a", kind: "red", description: "native dogfood docs red tests")
]

required_green_artifacts = [
  log("unit-1b-contract-green.log", unit: "1b", kind: "implementation-green", description: "REST v1 contract registry implementation green"),
  log("unit-2b-me-green.log", unit: "2b", kind: "implementation-green", description: "native account API implementation green"),
  log("unit-3b-users-search-green.log", unit: "3b", kind: "implementation-green", description: "user/search API implementation green"),
  log("unit-4b-recipe-writes-green.log", unit: "4b", kind: "implementation-green", description: "recipe write API implementation green"),
  log("unit-5b-recipe-steps-green.log", unit: "5b", kind: "implementation-green", description: "recipe step API implementation green"),
  log("unit-6b-covers-green.log", unit: "6b", kind: "implementation-green", description: "recipe cover API implementation green"),
  log("unit-7b-spoons-green.log", unit: "7b", kind: "implementation-green", description: "spoon cook-log API implementation green"),
  log("unit-8b-cookbook-writes-green.log", unit: "8b", kind: "implementation-green", description: "cookbook write API implementation green"),
  log("unit-9b-shopping-parity-green.log", unit: "9b", kind: "implementation-green", description: "shopping API implementation green"),
  log("unit-10b-sync-green.log", unit: "10b", kind: "implementation-green", description: "native sync API implementation green"),
  log("unit-10e-recipe-import-green.log", unit: "10e", kind: "implementation-green", description: "recipe import API implementation green"),
  log("unit-20b-aasa-green.log", unit: "20b", kind: "implementation-green", description: "AASA route implementation green"),
  log("unit-24b-docs-green.log", unit: "24b", kind: "implementation-green", description: "native dogfood docs implementation green")
]

coverage_entries = ["web-focused", "web-docs-drift", "web-playground-generate", "web-typecheck", "web-coverage-full", "web-warning-scan"].freeze

required_matrix_artifacts = [
  *matrix_artifacts(unit: "1c", slug: "unit-1c-contract", entries: ["web-focused", "web-route-coverage", "web-docs-drift", "web-playground-generate", "web-typecheck", "web-warning-scan"]),
  *matrix_artifacts(unit: "2c", slug: "unit-2c-account", entries: coverage_entries),
  *matrix_artifacts(unit: "3c", slug: "unit-3c-users-search", entries: coverage_entries),
  *matrix_artifacts(unit: "4c", slug: "unit-4c-recipe-writes", entries: coverage_entries),
  *matrix_artifacts(unit: "5c", slug: "unit-5c-recipe-steps", entries: coverage_entries),
  *matrix_artifacts(unit: "6c", slug: "unit-6c-covers", entries: coverage_entries),
  *matrix_artifacts(unit: "7c", slug: "unit-7c-spoons", entries: coverage_entries),
  *matrix_artifacts(unit: "8c", slug: "unit-8c-cookbook-writes", entries: coverage_entries),
  *matrix_artifacts(unit: "9c", slug: "unit-9c-shopping-parity", entries: coverage_entries),
  *matrix_artifacts(unit: "10c", slug: "unit-10c-sync", entries: ["web-focused", "web-route-coverage", "web-docs-drift", "web-playground-generate", "web-typecheck", "web-coverage-full", "web-warning-scan"]),
  *matrix_artifacts(unit: "10f", slug: "unit-10f-recipe-import", entries: ["web-focused", "web-route-coverage", "web-docs-drift", "web-playground-generate", "web-typecheck", "web-coverage-full", "web-warning-scan"]),
  *matrix_artifacts(
    unit: "20c",
    slug: "unit-20c-aasa",
    entries: ["web-focused", "web-typecheck", "web-build", "web-coverage-full", "web-warning-scan"],
    aliases: {
      "unit-20c-aasa-vitest.log" => ["unit-20c-aasa-vitest.log", "unit-20c-aasa-green.log"]
    }
  ),
  *matrix_artifacts(unit: "24c", slug: "unit-24c-docs", entries: ["web-route-coverage", "web-docs-drift", "web-playground-generate", "web-typecheck", "web-build", "web-warning-scan"])
]

required_blocker_artifacts = [
  blocker("provider-secret-blocker-recipe-covers.json", unit: "6c", description: "recipe cover provider secret blocker", expected_capability: "ProviderSecret"),
  blocker("provider-secret-blocker-recipe-import.json", unit: "10f", description: "recipe import provider secret blocker", expected_capability: "ProviderSecret")
]

source_test_mappings = [
  {
    "source" => "app/lib/api-v1-contract.server.ts",
    "tests" => ["test/config/api-v1-route-coverage.test.ts", "test/docs/developer-platform-docs.test.ts"],
    "artifacts" => ["web/unit-1a-contract-red.log", "web/unit-1b-contract-green.log", "web/unit-1c-contract-route-coverage.log"]
  },
  {
    "source" => "app/lib/api-v1-openapi.server.ts",
    "tests" => ["test/lib/api-v1-openapi.server.test.ts", "test/routes/api-v1-openapi.test.ts"],
    "artifacts" => ["web/unit-1a-contract-red.log", "web/unit-1b-contract-green.log", "web/unit-24c-docs-docs-drift.log"]
  },
  {
    "source" => "app/lib/api-v1.server.ts",
    "tests" => ["test/routes/api-v1-shell.test.ts", "test/routes/api-v1-telemetry.test.ts"],
    "artifacts" => ["web/unit-1a-contract-red.log", "web/unit-1b-contract-green.log", "web/unit-4c-recipe-writes-vitest.log"]
  },
  {
    "source" => "app/lib/api-v1-recipe-writes.server.ts",
    "tests" => ["test/lib/api-v1-recipe-writes.server.test.ts", "test/routes/api-v1-recipe-writes.test.ts"],
    "artifacts" => ["web/unit-4a-recipe-writes-red.log", "web/unit-4b-recipe-writes-green.log", "web/unit-4c-recipe-writes-vitest.log"]
  },
  {
    "source" => "app/lib/api-v1-recipe-steps.server.ts",
    "tests" => ["test/lib/api-v1-recipe-steps.server.test.ts", "test/routes/api-v1-recipe-steps.test.ts"],
    "artifacts" => ["web/unit-5a-recipe-steps-red.log", "web/unit-5b-recipe-steps-green.log", "web/unit-5c-recipe-steps-vitest.log"]
  },
  {
    "source" => "app/routes/api.v1.$.ts",
    "tests" => [
      "test/routes/api-v1-recipes.test.ts",
      "test/routes/api-v1-tokens.test.ts",
      "test/routes/api-v1-search.test.ts",
      "test/routes/api-v1-recipe-covers.test.ts",
      "test/routes/api-v1-recipe-spoons.test.ts",
      "test/routes/api-v1-cookbooks.test.ts",
      "test/routes/api-v1-shopping-mutations.test.ts",
      "test/routes/api-v1-shopping-sync.test.ts",
      "test/routes/api-v1-recipe-import.test.ts"
    ],
    "artifacts" => ["web/unit-1a-contract-red.log", "web/unit-1b-contract-green.log", "web/unit-10f-recipe-import-route-coverage.log"]
  },
  {
    "source" => "app/lib/spoonjoy-api.server.ts",
    "tests" => [
      "test/routes/api-v1-recipes.test.ts",
      "test/routes/api-v1-recipe-spoons.test.ts",
      "test/routes/api-v1-cookbooks.test.ts",
      "test/routes/api-v1-shopping-mutations.test.ts",
      "test/routes/api-v1-shopping-sync.test.ts",
      "test/routes/api-v1-recipe-import.test.ts",
      "test/lib/spoonjoy-api-spoons.test.ts",
      "test/lib/spoonjoy-api-cookbook-notification.test.ts",
      "test/lib/spoonjoy-api-import.test.ts"
    ],
    "artifacts" => ["web/unit-4a-recipe-writes-red.log", "web/unit-4b-recipe-writes-green.log", "web/unit-10f-recipe-import-vitest.log"]
  },
  {
    "source" => "app/lib/spoonjoy-api-request.server.ts",
    "tests" => ["test/lib/spoonjoy-api-request.server.test.ts"],
    "artifacts" => ["web/unit-1a-contract-red.log", "web/unit-1b-contract-green.log", "web/unit-1c-contract-vitest.log"]
  },
  {
    "source" => "app/lib/recipe-fork.server.ts",
    "tests" => ["test/lib/recipe-fork.server.test.ts", "test/routes/api-v1-recipe-writes.test.ts"],
    "artifacts" => ["web/unit-4a-recipe-writes-red.log", "web/unit-4b-recipe-writes-green.log", "web/unit-4c-recipe-writes-vitest.log"]
  },
  {
    "source" => "app/lib/account-settings.server.ts",
    "tests" => ["test/routes/api-v1-account-settings.test.ts", "test/routes/api-v1-tokens.test.ts"],
    "artifacts" => ["web/unit-2a-me-red.log", "web/unit-2b-me-green.log", "web/unit-2c-account-vitest.log"]
  },
  {
    "source" => "app/lib/search.server.ts",
    "tests" => ["test/routes/api-v1-search.test.ts"],
    "artifacts" => ["web/unit-3a-users-search-red.log", "web/unit-3b-users-search-green.log", "web/unit-3c-users-search-vitest.log"]
  },
  {
    "source" => "app/lib/recipe-cover.server.ts",
    "tests" => ["test/routes/api-v1-recipe-covers.test.ts", "test/lib/recipe-cover.server.test.ts"],
    "artifacts" => ["web/unit-6a-covers-red.log", "web/unit-6b-covers-green.log", "web/unit-6c-covers-vitest.log"]
  },
  {
    "source" => "app/lib/recipe-spoon.server.ts",
    "tests" => ["test/routes/api-v1-recipe-spoons.test.ts", "test/lib/spoonjoy-api-spoons.test.ts"],
    "artifacts" => ["web/unit-7a-spoons-red.log", "web/unit-7b-spoons-green.log", "web/unit-7c-spoons-vitest.log"]
  },
  {
    "source" => "app/lib/recipe-import.server.ts",
    "tests" => ["test/routes/api-v1-recipe-import.test.ts", "test/lib/recipe-import.test.ts", "test/lib/spoonjoy-api-import.test.ts"],
    "artifacts" => ["web/unit-10d-recipe-import-red.log", "web/unit-10e-recipe-import-green.log", "web/unit-10f-recipe-import-vitest.log"]
  },
  {
    "source" => "app/lib/shopping-list.server.ts",
    "tests" => ["test/routes/api-v1-shopping-mutations.test.ts", "test/routes/api-v1-shopping-conflicts.test.ts", "test/routes/api-v1-shopping-sync.test.ts"],
    "artifacts" => ["web/unit-9a-shopping-parity-red.log", "web/unit-9b-shopping-parity-green.log", "web/unit-9c-shopping-parity-vitest.log"]
  },
  {
    "source" => "app/lib/web-route-manifest.server.ts",
    "tests" => ["test/routes/aasa-contract.test.ts", "test/routes/route-shell-coverage.test.ts"],
    "artifacts" => ["web/unit-20a-route-manifest-red.log", "web/unit-20b-aasa-green.log", "web/unit-20c-aasa-green.log"]
  },
  {
    "source" => "app/routes/well-known.apple-app-site-association.ts",
    "tests" => ["test/routes/aasa-contract.test.ts"],
    "artifacts" => ["web/unit-20a-aasa-red.log", "web/unit-20b-aasa-green.log", "web/unit-20c-aasa-green.log"]
  },
  {
    "source" => "app/lib/security-headers.server.ts",
    "tests" => ["test/lib/security-headers.server.test.ts"],
    "artifacts" => ["web/unit-25c-web-final-green-coverage.log"]
  },
  {
    "source" => "app/lib/telemetry-coverage/allowlist.ts",
    "tests" => ["test/lib/telemetry-coverage.test.ts"],
    "artifacts" => ["web/unit-25c-web-final-green-coverage.log"]
  },
  {
    "source" => "app/routes/oauth.callback.tsx",
    "tests" => ["test/routes/oauth-callback.test.tsx", "test/routes/aasa-contract.test.ts"],
    "artifacts" => ["web/unit-20c-aasa-green.log", "web/unit-25c-web-final-green-coverage.log"]
  },
  {
    "source" => "app/routes/developers.tsx",
    "tests" => ["test/docs/developer-platform-guide.test.ts", "test/routes/developers.test.tsx"],
    "artifacts" => ["web/unit-24a-docs-red.log", "web/unit-24b-docs-green.log", "web/unit-24c-docs-docs-drift.log"]
  },
  {
    "source" => "app/routes/developers.playground.tsx",
    "tests" => ["test/routes/developers-playground.test.tsx"],
    "artifacts" => ["web/unit-1a-contract-red.log", "web/unit-1b-contract-green.log", "web/unit-24c-docs-docs-drift.log"]
  },
  {
    "source" => "docs/api.md",
    "tests" => ["test/docs/developer-platform-docs.test.ts", "test/docs/native-dogfood-docs.test.tsx"],
    "artifacts" => ["web/unit-24a-docs-red.log", "web/unit-24b-docs-green.log", "web/unit-24c-docs-docs-drift.log"]
  },
  {
    "source" => "docs/telemetry-coverage.md",
    "tests" => ["test/lib/telemetry-coverage.test.ts"],
    "artifacts" => ["web/unit-25c-web-final-green-coverage.log"]
  },
  {
    "source" => "scripts/generate-api-playground.ts",
    "tests" => ["test/scripts/generate-api-playground.test.ts"],
    "artifacts" => ["web/unit-1a-contract-red.log", "web/unit-1b-contract-green.log", "web/unit-24c-docs-api-playground-generate.log"]
  },
  {
    "source" => "app/lib/generated/api-v1-playground.ts",
    "tests" => ["test/scripts/generate-api-playground.test.ts", "test/routes/developers-playground.test.tsx"],
    "artifacts" => ["web/unit-1a-contract-red.log", "web/unit-1b-contract-green.log", "web/unit-24c-docs-api-playground-drift.log"]
  },
  {
    "source" => "vite.config.ts",
    "tests" => ["test/build-output-hygiene.test.ts"],
    "artifacts" => ["web/unit-24b-review-fix-focused-green.log", "web/unit-24b-review-fix-build.log", "web/unit-24c-docs-build.log"]
  }
]

def existing_accepted_path(artifact_root, item)
  item.fetch("acceptedPaths").find { |path| File.exist?(File.join(artifact_root, path)) }
end

def artifact_failures(artifact_root, items)
  items.flat_map do |item|
    existing = existing_accepted_path(artifact_root, item)
    if existing.nil?
      ["missing #{item["kind"]} artifact #{item["path"]} (accepted: #{item["acceptedPaths"].join(", ")})"]
    else
      full_path = File.join(artifact_root, existing)
      failures = []
      if !item.fetch("allowEmpty") && File.file?(full_path) && File.size(full_path).zero?
        failures << "empty #{item["kind"]} artifact #{existing}"
      end
      if item["expectedCapability"]
        begin
          parsed = JSON.parse(File.read(full_path))
          unless parsed["blocked"] == true && parsed["capability"] == item["expectedCapability"]
            failures << "invalid blocker #{existing}: expected blocked=true capability=#{item["expectedCapability"]}"
          end
        rescue JSON::ParserError => e
          failures << "invalid JSON blocker #{existing}: #{e.message}"
        end
      end
      failures
    end
  end
end

def mapping_failures(artifact_root, mappings)
  mappings.flat_map do |mapping|
    failures = []
    failures << "missing mapped source #{mapping["source"]}" unless File.exist?(mapping["source"])
    missing_tests = mapping.fetch("tests").reject { |path| File.exist?(path) }
    failures << "mapping #{mapping["source"]} has missing tests: #{missing_tests.join(", ")}" unless missing_tests.empty?
    if mapping.fetch("artifacts").none? { |path| File.exist?(File.join(artifact_root, path)) }
      failures << "mapping #{mapping["source"]} has no existing evidence artifact"
    end
    failures
  end
end

def branch_changed_sources
  stdout, stderr, status = Open3.capture3("git", "diff", "--name-only", "origin/main...HEAD")
  return [[], ["unable to inspect changed sources: #{stderr.strip}"]] unless status.success?

  [stdout.lines.map(&:strip).reject(&:empty?), []]
end

def source_mapping_scope?(path)
  return false if path.start_with?("test/")
  return false if path == "scripts/audit-web-validation-artifacts.rb"

  path.start_with?("app/routes/") ||
    path.start_with?("app/lib/") ||
    path == "docs/api.md" ||
    path == "docs/telemetry-coverage.md" ||
    path == "scripts/generate-api-playground.ts" ||
    path == "vite.config.ts"
end

all_required_artifacts = required_red_artifacts + required_green_artifacts + required_matrix_artifacts + required_blocker_artifacts
changed_sources, changed_source_errors = branch_changed_sources
mapped_sources = source_test_mappings.map { |mapping| mapping["source"] }.to_set
unmapped_changed_sources = changed_sources.select { |path| source_mapping_scope?(path) && !mapped_sources.include?(path) }

checks = {
  "artifactFailures" => artifact_failures(artifact_root, all_required_artifacts),
  "mappingFailures" => mapping_failures(artifact_root, source_test_mappings),
  "changedSourceInspectionFailures" => changed_source_errors,
  "unmappedChangedSources" => unmapped_changed_sources
}

manifest = {
  "schemaVersion" => 1,
  "generatedAt" => Time.now.utc.iso8601,
  "artifactRoot" => artifact_root,
  "webArtifactDir" => web_artifact_dir,
  "requiredRedArtifacts" => required_red_artifacts,
  "requiredGreenArtifacts" => required_green_artifacts,
  "requiredMatrixArtifacts" => required_matrix_artifacts,
  "requiredBlockerArtifacts" => required_blocker_artifacts,
  "requiredSourceTestMappings" => source_test_mappings,
  "branchChangedSources" => changed_sources,
  "checks" => checks,
  "ok" => checks.values.all?(&:empty?)
}

FileUtils.mkdir_p(File.dirname(manifest_path))
File.write(manifest_path, JSON.pretty_generate(manifest) + "\n")

if manifest["ok"]
  puts "web validation artifact audit ok"
  puts "manifest: #{manifest_path}"
  exit 0
end

puts "web validation artifact audit FAILED"
puts "manifest: #{manifest_path}"
checks.each do |name, failures|
  next if failures.empty?

  puts
  puts "#{name}:"
  failures.each { |failure| puts "- #{failure}" }
end
exit 1
