import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";

const connectionString = process.env.DATABASE_URL;

try {
    const adapter = new PrismaMssql(connectionString);
    const prisma = new PrismaClient({ adapter });

    let user = await prisma.user.findFirst();
    if (!user) {
        console.log("No user found, creating one...");
        try {
            user = await prisma.user.create({
                data: {
                    name: "Test User",
                    email: "test@example.com"
                }
            });
        } catch (err) {
             // If create fails (e.g. email unique), try to find by email
             user = await prisma.user.findUnique({ where: { email: "test@example.com" } });
        }
    }
    console.log("UserID:", user?.id);

    await prisma.$disconnect();
} catch (e) {
    console.error("Error:", e);
    process.exit(1);
}
