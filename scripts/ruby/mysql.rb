#!/usr/bin/env ruby
STDOUT.reopen '/var/log/provision', 'a'
STDERR.reopen '/var/log/provision', 'a'

# Replication user and password
unless (ENV['REPLICATION_USER'] && ENV['REPLICATION_PASSWORD'] && ENV['IS_REPLICA'] &&
  ENV['MASTER_HOST'] && ENV['SERVER_ID'])
  raise StandardError, "Provide all the required environment variables"
end

# Non-interactive installation
mysql_apt_config = 'mysql-apt-config_0.8.10-1_all.deb'
install_file = 'mysql-install.sh'
install_script = <<EOF
#!/bin/bash -x
export DEBIAN_FRONTEND="noninteractive"
echo mysql-apt-config mysql-apt-config/select-server select mysql-8.0 | debconf-set-selections
wget http://dev.mysql.com/get/#{mysql_apt_config}
dpkg -i #{mysql_apt_config}
apt update -q
apt install -q -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" mysql-server
EOF

File.open(install_file, 'w') { |f| f.write install_script }
system("chmod +x #{install_file}")
system("./#{install_file}")

# Replication and GTID replication configuration
replication_user = ENV['REPLICATION_USER']
replication_password = ENV['REPLICATION_PASSWORD']
server_id = ENV['SERVER_ID']
config_script = 'configuration.sql'
user_configuration = <<EOF
CREATE USER '#{replication_user}'@'%' IDENTIFIED BY '#{replication_password}'; 
GRANT REPLICATION SLAVE ON *.* TO '#{replication_user}'@'%';
FLUSH TABLES WITH READ LOCK;
SET PERSIST server_id=#{server_id};
SET PERSIST_ONLY gtid_mode=ON;
SET PERSIST_ONLY enforce_gtid_consistency=true;
RESTART;
EOF
File.open(config_script, 'w') { |f| f.write user_configuration }
system("mysql -f < #{config_script}")

# Wait for mysql to start
while `service mysql status`['running'].nil?
  sleep 2
end

# If we are not on a replica node then just bail
exit unless ENV['IS_REPLICA'].to_s.strip === '1'

# All the replica configuration
master_host = ENV['MASTER_HOST']
replica_config_file = 'replica-config.sql'
replica_status_file = 'replica-status'
replica_config = <<EOF
STOP SLAVE;
CHANGE MASTER TO
  MASTER_HOST='#{master_host}',
  MASTER_USER='#{replication_user}',
  MASTER_PASSWORD='#{replication_password}',
  MASTER_AUTO_POSITION=1;
START SLAVE;
SHOW SLAVE STATUS;
EOF
File.open(replica_config_file, 'w') { |f| f.write replica_config }
system("mysql -f < #{replica_config_file} > #{replica_status_file}")