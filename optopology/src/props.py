app_port = 5017
# db_server = 'tcp:HOAGSQLLSN74,5433'
# db_port = '5433'
# db_name = 'IT_Operations_Plattform'
# db_user = 'SV_ ITOperPlat_Login'
# db_pwd = 'UUhGcTMzSnRjVjQ9UVZFek9TRnpkM0U9'

# SQL Server configuration (matching docker-compose.yml)
db_server = 'mysql,1433'  # Service name 'mysql' but it's actually SQL Server, port 1433 inside container
db_port = '1433'
db_name = 'tempdb'  # Use tempdb which is always available in SQL Server
db_user = 'sa'
db_pwd = 'AQ39!swq'
num_of_threads = 300
ssh_timeout=60
