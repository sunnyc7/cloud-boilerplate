#!/usr/bin/env ruby
# Re-open STDOUT/STDERR because every cloud provider likes to ship the logs
# to different places so if we want to be consistent then we need to control
# them ourselves
STDOUT.reopen '/var/log/provision', 'a'
STDERR.reopen '/var/log/provision', 'a'

require 'fileutils'
require 'json'

# Interface: ENDPOINT, NODE_COUNT, CONSUL_DOWNLOAD_URL
STDOUT.puts "Script directory: #{File.dirname(__FILE__)}"
STDOUT.puts "Script file: #{__FILE__}"

# Directory where we will put everything
FileUtils.mkdir_p "/consul"
Dir.chdir "/consul"

# Check to see if consul is already there and skip the download if it is
consul_exists = `./consul -v` rescue nil
unless consul_exists
  # Download the consul zip file
  command = "wget '#{ENV['CONSUL_DOWNLOAD_URL']}'"
  output = `#{command}`
  while $?.exitstatus > 0
    STDERR.puts output
    sleep 5
    output = `#{command}`
  end
  [
    "apt install -y zip",
    "unzip -o *.zip",
    "rm -f *.zip"
  ].each { |command| system(command) }
end

# We need the private address for coordination. For some reason it is different on all
# the cloud providers so we have to try a bunch of them before we get the address
self_address = ''
(0..5).flat_map { |i| ["eth#{i}", "ens#{i}"] }.each do |interface|
  self_address = `ip addr show #{interface} | grep 'inet ' | awk '{print $2}' | cut -f1 -d'/'`.strip
  break unless self_address.empty?
end

# Metadata endpoint for coordination
metadata_endpoint = "#{ENV['ENDPOINT']}/metadata/consul"

# Initialize the hosts so it can be populated. This can fail so we need to loop until success.
# Do this only if the there are no hosts already
if `curl -k "#{metadata_endpoint}/hosts.length"`.strip.to_i <= 0
  initial_payload = {hosts: []}.to_json
  command = "set -x; curl -k -XPOST -d '#{initial_payload}' '#{metadata_endpoint}'"
  output = `#{command}`
  # Verify that we actually created the root object
  while (output = `curl -k '#{metadata_endpoint}.keys'`)["hosts"].nil?
    STDERR.puts output
    sleep 2
    output = `#{command}`
    STDERR.puts output
  end
end

# If we don't have enough registered nodes then loop until we do
while (output = `curl -k '#{metadata_endpoint}/hosts.length'`).strip.to_i < ENV['NODE_COUNT'].to_i
  STDERR.puts output
  # It is possible some other node reset everything so make sure we re-register
  if (output = `set -x; curl -k '#{metadata_endpoint}'`)[self_address].nil?
    STDERR.puts output
    STDERR.puts `set -x; curl -k -XPOST '#{metadata_endpoint}/hosts' -d '"#{self_address}"'`
  end
  sleep 1
end

# Whoever registered first will set a key
if `set -x; curl -k '#{metadata_endpoint}/hosts/0'`[self_address]
  key = `./consul keygen`.strip[0...24]
  key_payload = {key: key}.to_json
  STDERR.puts `set -x; curl -k -XPOST -d '#{key_payload}' '#{metadata_endpoint}'`
end

# Wait for the key to be set
while (output = `curl -k '#{metadata_endpoint}.keys'`)["key"].nil?
  STDERR.puts "Waiting for key to be set"
  STDERR.puts output
  sleep 1
end

# Everyone is registered and there is a key so we can form the cluster.
encryption_key = `curl -k '#{metadata_endpoint}/key'`.tr('"', '')
main_host = `curl -k '#{metadata_endpoint}/hosts/0'`.tr('"', '')
# In a production environment all these settings would be put in a file to avoid
# leaking any secret tokens
command = [
  "./consul agent -ui -syslog -server -bootstrap-expect #{ENV['NODE_COUNT']}",
  "-data-dir '/consul'",
  "-bind '#{self_address}'",
  "-advertise '#{self_address}'",
  "-encrypt '#{encryption_key}'",
  "-retry-join '#{main_host}'",
  '&'
].join(' ')

# Double fork and start the consul process as a daemon
Process.fork do
  Process.setsid
  p = Process.fork do
    STDIN.reopen '/dev/null'
    STDOUT.reopen '/consul/output.log', 'a'
    STDERR.reopen '/consul/output.log', 'a'
    # Run things in a loop so that in case the process dies we bring it back
    loop do
      unless `ps aux`["consul agent"]
        consul = Process.fork { exec(command) }
        Process.detach(consul)
      end
      sleep 2
    end
  end
  Process.detach(p)
end