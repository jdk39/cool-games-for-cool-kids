# Terraform instructions (CODE IS NOT COMPLETE YET)

In variables.tf, change profile's default to your username. (A role made specifically for terraform would be appropriate here in the future.)

Run 'aws login --profile {your username}'

Run 'terraform apply' to build, 'terraform destroy' to tear down

## Terraform-generated plan

- Create 2 EIPs for the public EC2s
- Create 2 EIPs to attach to the NAT gateway
- Create public-alb
- Create HTTP and HTTPS listeners for the alb
- Create NAT gateway with EIPs attached
- Create an updated route to the NAT in each private rtb

## To-do:

- Terraform can't see what we have in AWS yet, so terraform apply will build duplicates of everything
    - Can run ./down.sh and manually delete NAT resources, then run terraform apply. Terraform remembers what it builds, so this problem will only come up when we add new resources that cost money
    - Alternative is manually adding each item to import.tf so terraform sees them. The benefit of this is once terraform acknowledges them all, I'll know if everything is a 1:1 configuration or if it sees any differences
- Figure out how to start EC2s on apply, stop EC2s on destroy
- Fill out references.tf
    - Some ARNs and IDs are hardcoded throughout main.tf
    - Would be better if all hardcoded IDs were organized on one file; if something meant to be permanent is accidentally deleted, it's less of a hassle to change the code this way
    - Other files would reference the data block they're in to get IDs