#!/usr/bin/env ruby
require 'fileutils'
require 'json'

# Interface: ENDPOINT, NODE_COUNT, CONSUL_DOWNLOAD_URL
STDOUT.puts "Script directory: #{File.dirname(__FILE__)}"
STDOUT.puts "Script file: #{__FILE__}"

# Directory where we will put everything
FileUtils.mkdir_p "/consul"
Dir.chdir "/consul"

# Download the consul zip file
command = "wget '#{ENV['CONSUL_DOWNLOAD_URL']}'"
`#{command}`
while $?.exitstatus > 0
  sleep 5
  `#{command}`
end

# Install zip utilities to unzip the consul binary
`apt install -y zip`
`unzip -o *.zip`
`rm -f *.zip`

# We need the private address for coordination
self_address = `"$(ip addr show eth0 | grep 'inet ' | awk '{print $2}' | cut -f1 -d'/')"`.strip

# Metadata endpoint for coordination
metadata_endpoint = "#{ENV['ENDPOINT']}/metadata/consul"

# Initialize the hosts so it can be populated. This can fail so we need to loop until success.
# Do this only if the there are no hosts already
if `curl -k "#{metadata_endpoint}/hosts.length"`.strip.to_i <= 0
  payload = {hosts: []}.to_json
  command = "curl -k -XPOST '#{metadata_endpoint}' -d '#{payload}'"
  `#{command}`
  while $?.exitstatus > 0
    sleep 2
    `#{command}`
  end
end

# If we don't have enough registered nodes then loop until we do
while `curl -k '#{metadata_endpoint}/hosts.length'`.strip.to_i < ENV['NODE_COUNT'].to_i
  # It is possible some other node reset everything so make sure we re-register
  if `curl -k '#{metadata_endpoint}'`[self_address].nil?
    `curl -k -XPOST '#{metadata_endpoint}/hosts' -d '#{self_address}'`
  end
  sleep 1
end

# Whoever registered first will set a key
if `curl -k '#{metadata_endpoint}/hosts/0'`[self_address]
  key = `./consul keygen`.strip[0...24]
  payload = {key: key}.to_json
  `curl -k -XPOST -d '#{payload}' '#{metadata_endpoint}'`
end

# Wait for the key to be set
while `curl -k '#{metadata_endpoint}.keys'`["key"].nil?
  sleep 1
end

# Everyone is registered and there is a key so we can form the cluster.
# In a production setting this would be an actual systemd unit file 
# and you would not use public facing IP addresses, i.e. you'd run
# the nodes in a private address space
encryption_key = `curl -k '#{metadata_endpoint}/key'`.tr('"', '')
main_host = `curl -k '#{metadata_endpoint}/hosts/0'`.tr('"', '')
command = [
  "nohup ./consul agent -ui -syslog -server -bootstrap-expect #{ENV['NODE_COUNT']}",
  "-data-dir '/consul'",
  "-bind '#{self_address}'",
  "-advertise '#{self_address}'",
  "-encrypt '#{encryption_key}'",
  "-retry-join '#{main_host}'",
  '&'
].join(' ')
`#{command}`