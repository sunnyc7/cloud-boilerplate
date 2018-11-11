#!/usr/bin/env ruby
require 'fileutils'

# Useful information for debugging when looking at /var/log/cloud-init-output.log
STDOUT.puts "Script directory: #{File.dirname(__FILE__)}"
STDOUT.puts "Script file: #{__FILE__}"
# Start the provisinoing process
`apt update`
`apt install --yes git`
`git clone https://github.com/cloudbootup/cloud-init-buddy.git`
FileUtils.mkdir_p "/cloud-init-buddy"
Dir.chdir "/cloud-init-buddy"
`rake setup:initialize`
`rake flyway:check || rake flyway:install`
`rake postgres:configure`
`npm install`
# We need to listen on all interfaces. Default configuration listens
# only on localhost (127.0.0.1)
`sed -i 's/127.0.0.1/0.0.0.0/' lib/config.ts`
# Compile everything to js. Don't error out if there is an error because
# some files will not have type information so tsc will complain.
`./node_modules/.bin/tsc`
# Generate certificates. We want to sever everything over HTTPS.
`node utils/generate-certificate.js`
# Start the application in a tmux session. In a production environment
# this should be a systemd unit file instead of a fork loop
Process.fork do
  Process.setsid
  p = Process.fork do
    STDIN.reopen '/dev/null'
    STDOUT.reopen '/tmp/cloud-init-buddy-watcher.log', 'a'
    STDERR.reopen '/tmp/cloud-init-buddy-watcher.log', 'a'
    loop do
      running = `ps aux`["app.js"]
      if running.nil?
        STDERR.puts "Looks like cloud-init-buddy is not running. Trying to start"
        `tmux new-session -d -s cloud-init-buddy 'node app.js'`
      end
      sleep 2
    end
  end
  Process.detach(p)
end
# Keep the password around just in case
File.open('password', 'w') { |f| f.write ENV['BUDDY_PASSWORD'] }
# Add the admin user and any other necessary users so that other nodes
# can talk to cloud-init-buddy and coordinate. This also needs to be a loop
# to make sure the admin user doesn't go away or run into some weird race condition
# with the dying process
Process.fork do
  Process.setsid
  p = Process.fork do
    STDIN.reopen '/dev/null'
    STDOUT.reopen '/dev/null', 'a'
    STDERR.reopen '/dev/null', 'a'
    loop do
      `node utils/users.js add-user "#{ENV['BUDDY_USER']}" "#{ENV['BUDDY_PASSWORD']}"`
      sleep 5
    end
  end
  Process.detach(p)
end