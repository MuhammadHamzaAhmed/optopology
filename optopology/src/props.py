import os

app_port = 5017

# MongoDB configuration (can be overridden by environment variables)
mongo_host = os.environ.get('MONGO_HOST', 'localhost')
mongo_port = int(os.environ.get('MONGO_PORT', 27017))
mongo_user = os.environ.get('MONGO_USER', 'admin')
mongo_password = os.environ.get('MONGO_PASSWORD', 'topology_pass')
mongo_db = os.environ.get('MONGO_DB', 'optopology')

# Collections
topology_dashboard_collection = 'network_topology_dashboard'
topology_block_collection = 'network_topology_block'

num_of_threads = 300
ssh_timeout = 60
