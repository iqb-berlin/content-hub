import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User, AcpUserRole, AcpRole } from "../database/entities";
import { CreateUserDto, UpdateUserDto } from "./dto/user.dto";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AcpUserRole)
    private readonly acpUserRoleRepository: Repository<AcpUserRole>,
  ) {}

  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      select: [
        "id",
        "username",
        "displayName",
        "isAppAdmin",
        "oidcSub",
        "createdAt",
        "updatedAt",
      ],
      order: { username: "ASC" },
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      select: [
        "id",
        "username",
        "displayName",
        "isAppAdmin",
        "oidcSub",
        "createdAt",
        "updatedAt",
      ],
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException(`Username "${dto.username}" already exists`);
    }

    const user = this.userRepository.create({
      username: dto.username,
      displayName: dto.displayName,
      isAppAdmin: dto.isAppAdmin ?? false,
    });
    const saved = await this.userRepository.save(user);
    return this.findById(saved.id);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (dto.displayName !== undefined) {
      user.displayName = dto.displayName;
    }
    await this.userRepository.save(user);
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Ensure at least one ACP manager remains per ACP.
    const managerRoles = await this.acpUserRoleRepository.find({
      where: { userId: id, role: AcpRole.ACP_MANAGER },
    });
    for (const managerRole of managerRoles) {
      const managerCount = await this.acpUserRoleRepository.count({
        where: { acpId: managerRole.acpId, role: AcpRole.ACP_MANAGER },
      });
      if (managerCount <= 1) {
        throw new BadRequestException(
          `Cannot delete user because AP ${managerRole.acpId} would have no ACP_MANAGER`,
        );
      }
    }

    await this.userRepository.remove(user);
  }

  async setAppAdmin(id: string, isAppAdmin: boolean): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    user.isAppAdmin = isAppAdmin;
    await this.userRepository.save(user);
    return this.findById(id);
  }
}
