import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@localhost";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "changeme";

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    console.log("Admin user already exists, skipping seed.");
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.create({
    data: {
      email: adminEmail,
      name: "Administrator",
      passwordHash,
      role: "superadmin",
    },
  });

  // Default firewall rules
  await prisma.firewallRule.createMany({
    data: [
      { direction: "inbound", protocol: "tcp", port: "22", action: "allow", priority: 1, description: "SSH" },
      { direction: "inbound", protocol: "tcp", port: "80", action: "allow", priority: 2, description: "HTTP" },
      { direction: "inbound", protocol: "tcp", port: "443", action: "allow", priority: 3, description: "HTTPS" },
      { direction: "inbound", protocol: "tcp", port: "3000", action: "allow", priority: 4, description: "Dashboard" },
      { direction: "inbound", protocol: "tcp", port: "4000", action: "allow", priority: 5, description: "API" },
      { direction: "inbound", protocol: "all", sourceIp: "0.0.0.0/0", action: "deny", priority: 999, description: "Default deny" },
    ],
  });

  console.log(`Seeded admin user: ${adminEmail}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
