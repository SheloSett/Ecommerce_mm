const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  // Crear usuario admin por defecto
  const hashedPassword = await bcrypt.hash("admin123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@tienda.com" },
    update: {},
    create: {
      email: "admin@tienda.com",
      password: hashedPassword,
      role: "ADMIN",
    },
  });

  console.log("Admin creado:", admin.email);

  // Crear categorías base
  const categories = [
    { name: "Cables", slug: "cables" },
    { name: "Auriculares", slug: "auriculares" },
    { name: "Cargadores", slug: "cargadores" },
    { name: "Almacenamiento", slug: "almacenamiento" },
    { name: "Periféricos", slug: "perifericos" },
    { name: "Accesorios", slug: "accesorios" },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
  }

  console.log("Categorías creadas");
  console.log("\n✅ Seed completado!");
  console.log("   Email admin: admin@tienda.com");
  console.log("   Password: admin123");
  console.log("   ⚠️  Cambia la contraseña después del primer login!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
