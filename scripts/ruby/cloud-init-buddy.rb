#!/usr/bin/env ruby
require 'fileutils'

# Fail early if the environment isn't properly configured
unless ENV['BUDDY_USER'] && ENV['BUDDY_PASSWORD']
  raise StandardError, "Can not provision node without knowing the username and password"
end

# Utility method for executing a sequence of commands
def execute_commands(commands)
  commands.each do |command|
    STDOUT.puts "Executing command: #{command}"
    system(command)
  end
end

# Useful information for debugging when looking at /var/log/cloud-init-output.log
STDOUT.puts "Script directory: #{File.dirname(__FILE__)}"
STDOUT.puts "Script file: #{__FILE__}"

# Start the provisinoing process
execute_commands([
  'apt update',
  'apt install --yes git',
  'git clone https://github.com/cloudbootup/cloud-init-buddy.git'
])

# Make and change to the directory for initializing cloud-init-buddy
FileUtils.mkdir_p "/cloud-init-buddy"
Dir.chdir "/cloud-init-buddy"

# Configure cloud-init-buddy and initialize the database
execute_commands([
  'rake setup:initialize',
  'rake flyway:check || rake flyway:install',
  'rake postgres:configure',
  'npm install',
])

execute_commands([
  "sed -i 's/127.0.0.1/0.0.0.0/' lib/config.ts", # Default is to listen on localhost only
  './node_modules/.bin/tsc', # Compile everything to js
  'node utils/generate-certificate.js', # Self signed certificate for HTTPS
])

# Process watcher with double fork exec pattern
Process.fork do
  Process.setsid
  p = Process.fork do
    log_file = '/tmp/cloud-init-buddy-watcher.log'
    STDIN.reopen '/dev/null'
    STDOUT.reopen log_file, 'a'
    STDERR.reopen log_file, 'a'
    loop do
      running = `ps aux`["app.js"]
      # Start the process if it is not running
      if running.nil?
        STDERR.puts "Looks like cloud-init-buddy is not running. Trying to start"
        app = Process.fork do
          exec("tmux new-session -d -s cloud-init-buddy 'node app.js'")
        end
        Process.detach(app)
      end
      sleep 2
      # Add the user if it doesn't exist already
      unless `node utils/users.js list-users`[ENV['BUDDY_USER']]
        user = Process.fork do
          exec("node utils/users.js add-user '#{ENV['BUDDY_USER']}' '#{ENV['BUDDY_PASSWORD']}'")
        end
        Process.detach(user)
      end
      # Truncate the log file if has grown too much
      log_size = File.stat(log_file).size / 1024 # bytes * kb / bytes = kb
      File.truncate(log_file, 0) if log_size > 1024 # 1024 * kb = mb
    end
  end
  Process.detach(p)
end

# Keep the password around just in case
File.open('password', 'w') { |f| f.write ENV['BUDDY_PASSWORD'] }